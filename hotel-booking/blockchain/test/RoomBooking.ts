import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

const DAY = 24 * 60 * 60;
const SLOT = 2 * 60 * 60;

function dayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY) * DAY;
}

async function currentTimestamp(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  if (!block) throw new Error("Latest block not available");
  return Number(block.timestamp);
}

async function nextSlot(daysAhead = 1): Promise<bigint> {
  const now = await currentTimestamp();
  const start = dayStart(now) + daysAhead * DAY + 9 * 60 * 60;
  return BigInt(start);
}

describe("RoomBooking", function () {
  async function deployRoom() {
    const roomBooking = await ethers.deployContract("RoomBooking");
    await roomBooking.addRoom("Harbor King Room", ethers.parseEther("1"));
    return roomBooking;
  }

  it("books a fixed two-hour slot and stores a user-indexed booking record", async function () {
    const roomBooking = await deployRoom();
    const startTime = await nextSlot();

    await expect(roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("1") }))
      .to.emit(roomBooking, "RoomBooked")
      .withArgs(1, startTime, await roomBooking.runner?.getAddress(), startTime, ethers.parseEther("1"));

    const booking = await roomBooking.getBooking(1, startTime);
    expect(booking.guest).to.equal(await roomBooking.runner?.getAddress());
    expect(booking.roomId).to.equal(1n);
    expect(booking.startTime).to.equal(startTime);
    expect(booking.amount).to.equal(ethers.parseEther("1"));
    expect(booking.active).to.equal(true);
    expect(booking.id).to.equal(1n);
    expect(await roomBooking.isSlotAvailable(1, startTime)).to.equal(false);
    expect(await roomBooking.getUserBookings(await roomBooking.runner?.getAddress())).to.deep.equal([1n]);
  });

  it("keeps multiple reservations for the same wallet", async function () {
    const roomBooking = await deployRoom();
    const firstSlot = await nextSlot(1);
    const secondSlot = await nextSlot(2);

    await roomBooking.bookRoom(1, firstSlot, { value: ethers.parseEther("1") });
    await roomBooking.bookRoom(1, secondSlot, { value: ethers.parseEther("1") });

    expect(await roomBooking.bookingCount()).to.equal(2n);
    expect(await roomBooking.getUserBookings(await roomBooking.runner?.getAddress())).to.deep.equal([1n, 2n]);
    expect((await roomBooking.getBookingById(1)).startTime).to.equal(firstSlot);
    expect((await roomBooking.getBookingById(2)).startTime).to.equal(secondSlot);
  });

  it("books multiple room slots in one transaction", async function () {
    const roomBooking = await deployRoom();
    const secondRoomPrice = ethers.parseEther("2");
    const firstSlot = await nextSlot(1);
    const secondSlot = await nextSlot(2);
    await roomBooking.addRoom("City Room", secondRoomPrice);

    await roomBooking.bookRooms(
      [1, 2],
      [firstSlot, secondSlot],
      { value: ethers.parseEther("3") },
    );

    expect(await roomBooking.bookingCount()).to.equal(2n);
    expect(await roomBooking.isSlotAvailable(1, firstSlot)).to.equal(false);
    expect(await roomBooking.isSlotAvailable(2, secondSlot)).to.equal(false);
  });

  it("allows at most four rooms", async function () {
    const roomBooking = await ethers.deployContract("RoomBooking");

    for (let roomId = 1; roomId <= 4; roomId += 1) {
      await roomBooking.addRoom(`Room ${roomId}`, ethers.parseEther("1"));
    }

    expect(await roomBooking.roomCount()).to.equal(4n);
    expect((await roomBooking.rooms(4)).exists).to.equal(true);

    const startTime = await nextSlot();
    for (let roomId = 1; roomId <= 4; roomId += 1) {
      await roomBooking.bookRoom(roomId, startTime, { value: ethers.parseEther("1") });
      expect(await roomBooking.isSlotAvailable(roomId, startTime)).to.equal(false);
    }

    await expect(roomBooking.addRoom("Room 5", ethers.parseEther("1")))
      .to.be.revertedWithCustomError(roomBooking, "MaxRoomsReached");
  });

  it("rejects a duplicate slot and incorrect payment", async function () {
    const roomBooking = await deployRoom();
    const startTime = await nextSlot();

    await expect(roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("0.5") }))
      .to.be.revertedWithCustomError(roomBooking, "IncorrectPayment");

    await roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("1") });
    await expect(roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("1") }))
      .to.be.revertedWithCustomError(roomBooking, "SlotUnavailable");
  });

  it("allows only fixed slots within the three-day booking window", async function () {
    const roomBooking = await deployRoom();
    const validSlot = await nextSlot(3);
    const invalidTime = validSlot + BigInt(60 * 60);
    const tooFar = validSlot + BigInt(DAY);

    expect(await roomBooking.isValidSlot(validSlot)).to.equal(true);
    expect(await roomBooking.isValidSlot(invalidTime)).to.equal(false);
    expect(await roomBooking.isValidSlot(tooFar)).to.equal(false);
  });

  it("allows a valid slot earlier today", async function () {
    const roomBooking = await deployRoom();
    const now = await currentTimestamp();
    const todaySlot = BigInt(dayStart(now) + 9 * 60 * 60);

    expect(await roomBooking.isValidSlot(todaySlot)).to.equal(true);
    await roomBooking.bookRoom(1, todaySlot, { value: ethers.parseEther("1") });
    expect(await roomBooking.isSlotAvailable(1, todaySlot)).to.equal(false);
  });

  it("cancels a booking, refunds the guest, and releases the slot", async function () {
    const roomBooking = await deployRoom();
    const [guest] = await ethers.getSigners();
    const startTime = await nextSlot();

    await roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("1") });
    await expect(roomBooking.cancelBooking(1, startTime))
      .to.emit(roomBooking, "BookingCancelled")
      .withArgs(1, startTime, guest.address);

    const booking = await roomBooking.getBooking(1, startTime);
    expect(booking.active).to.equal(false);
    expect((await roomBooking.getBookingById(1)).active).to.equal(false);
    expect(await roomBooking.isSlotAvailable(1, startTime)).to.equal(true);

    await roomBooking.bookRoom(1, startTime, { value: ethers.parseEther("1") });
    expect((await roomBooking.getBooking(1, startTime)).active).to.equal(true);
  });
});
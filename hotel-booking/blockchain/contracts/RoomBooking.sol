// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

contract RoomBooking {
	uint256 public constant BOOKING_DURATION = 2 hours;
	uint256 public constant MAX_ADVANCE = 3 days;
	uint256 public constant FIRST_SLOT_HOUR = 9 hours;
	uint256 public constant SLOT_COUNT = 6;
	uint256 public constant SLOT_INTERVAL = 2 hours;

	struct Room {
		string name;
		uint256 price;
		bool exists;
	}

	struct Booking {
		uint256 id;
		address guest;
		uint256 roomId;
		uint256 startTime;
		uint256 amount;
		bool active;
	}

	uint256 public roomCount;
	uint256 public bookingCount;
	mapping(uint256 => Room) public rooms;
	mapping(uint256 => mapping(uint256 => uint256)) public slotBooking;
	mapping(uint256 => Booking) public bookings;
	mapping(address => uint256[]) private userBookings;

	error InvalidRoom();
	error InvalidSlot();
	error SlotUnavailable();
	error IncorrectPayment();
	error NotGuest();
	error TransferFailed();
	error MaxRoomsReached();

	event RoomAdded(uint256 indexed roomId, string name, uint256 price);
	event RoomBooked(
		uint256 indexed roomId,
		uint256 indexed slotId,
		address indexed guest,
		uint256 startTime,
		uint256 amount
	);
	event BookingCancelled(
		uint256 indexed roomId,
		uint256 indexed slotId,
		address indexed guest
	);

	function addRoom(string calldata name, uint256 price) external returns (uint256 roomId) {
		require(price > 0, "Price is zero");
		if (roomCount >= 4) revert MaxRoomsReached();

		roomId = ++roomCount;
		rooms[roomId] = Room(name, price, true);
		emit RoomAdded(roomId, name, price);
	}

	function bookRoom(uint256 roomId, uint256 startTime) external payable {
		if (!rooms[roomId].exists) revert InvalidRoom();
		if (!_isValidSlot(startTime)) revert InvalidSlot();
		if (msg.value != rooms[roomId].price) revert IncorrectPayment();
		_bookRoom(roomId, startTime, msg.value);
	}

	function bookRooms(uint256[] calldata roomIds, uint256[] calldata startTimes) external payable {
		if (roomIds.length == 0 || roomIds.length != startTimes.length) revert InvalidSlot();

		uint256 totalPrice;
		for (uint256 index = 0; index < roomIds.length; index++) {
			if (!rooms[roomIds[index]].exists) revert InvalidRoom();
			if (!_isValidSlot(startTimes[index])) revert InvalidSlot();
			if (slotBooking[roomIds[index]][startTimes[index]] != 0) revert SlotUnavailable();
			totalPrice += rooms[roomIds[index]].price;
		}
		if (msg.value != totalPrice) revert IncorrectPayment();

		for (uint256 index = 0; index < roomIds.length; index++) {
			_bookRoom(roomIds[index], startTimes[index], rooms[roomIds[index]].price);
		}
	}

	function _bookRoom(uint256 roomId, uint256 startTime, uint256 amount) internal {

		uint256 slotId = startTime;
		if (slotBooking[roomId][slotId] != 0) revert SlotUnavailable();

		uint256 bookingId = ++bookingCount;
		bookings[bookingId] = Booking(
			bookingId,
			msg.sender,
			roomId,
			startTime,
			amount,
			true
		);
		slotBooking[roomId][slotId] = bookingId;
		userBookings[msg.sender].push(bookingId);

		emit RoomBooked(roomId, slotId, msg.sender, startTime, amount);
	}

	function cancelBooking(uint256 roomId, uint256 slotId) external {
		uint256 bookingId = slotBooking[roomId][slotId];
		Booking storage booking = bookings[bookingId];
		if (!booking.active) revert SlotUnavailable();
		if (booking.guest != msg.sender) revert NotGuest();

		uint256 refund = booking.amount;
		booking.active = false;
		slotBooking[roomId][slotId] = 0;

		(bool sent, ) = payable(msg.sender).call{value: refund}("");
		if (!sent) revert TransferFailed();

		emit BookingCancelled(roomId, slotId, msg.sender);
	}

	function cancelBookings(uint256[] calldata roomIds, uint256[] calldata slotIds) external {
		if (roomIds.length == 0 || roomIds.length != slotIds.length) revert InvalidSlot();

		uint256 refund;
		for (uint256 index = 0; index < roomIds.length; index++) {
			uint256 bookingId = slotBooking[roomIds[index]][slotIds[index]];
			Booking storage booking = bookings[bookingId];
			if (!booking.active) revert SlotUnavailable();
			if (booking.guest != msg.sender) revert NotGuest();
			refund += booking.amount;
		}

		for (uint256 index = 0; index < roomIds.length; index++) {
			uint256 bookingId = slotBooking[roomIds[index]][slotIds[index]];
			bookings[bookingId].active = false;
			slotBooking[roomIds[index]][slotIds[index]] = 0;
			emit BookingCancelled(roomIds[index], slotIds[index], msg.sender);
		}

		(bool sent, ) = payable(msg.sender).call{value: refund}("");
		if (!sent) revert TransferFailed();
	}

	function getBooking(uint256 roomId, uint256 slotId)
		external
		view
		returns (Booking memory)
	{
		return bookings[slotBooking[roomId][slotId]];
	}

	function getBookingById(uint256 bookingId) external view returns (Booking memory) {
		return bookings[bookingId];
	}

	function getUserBookings(address guest) external view returns (uint256[] memory) {
		return userBookings[guest];
	}

	function isSlotAvailable(uint256 roomId, uint256 slotId)
		external
		view
		returns (bool)
	{
		return rooms[roomId].exists && slotBooking[roomId][slotId] == 0;
	}

	function isValidSlot(uint256 startTime) external view returns (bool) {
		return _isValidSlot(startTime);
	}

	function slotIdFor(uint256 startTime) external pure returns (uint256) {
		return startTime;
	}

	function _isValidSlot(uint256 startTime) internal view returns (bool) {
		uint256 today = (block.timestamp / 1 days) * 1 days;
		if (startTime < today) return false;
		uint256 bookingDay = (startTime / 1 days) * 1 days;
		if (bookingDay > today + MAX_ADVANCE) return false;

		uint256 timeOfDay = startTime - (startTime / 1 days) * 1 days;
		if (timeOfDay < FIRST_SLOT_HOUR) return false;

		uint256 slotOffset = timeOfDay - FIRST_SLOT_HOUR;
		return slotOffset % SLOT_INTERVAL == 0 && slotOffset / SLOT_INTERVAL < SLOT_COUNT;
	}
}

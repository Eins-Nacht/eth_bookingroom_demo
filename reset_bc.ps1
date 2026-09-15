```powershell
$root = "C:\Users\sheeg\Downloads\spn\hotel-booking"
$blockchain = "$root\blockchain"
$frontend = "$root\frontend"
$envFile = "$frontend\.env"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Resetting Hotel Booking Blockchain" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Clean Hardhat
Set-Location $blockchain

Write-Host "`n[1/5] Cleaning Hardhat..." -ForegroundColor Yellow
npx hardhat clean

if ($LASTEXITCODE -ne 0) {
    Write-Host "Hardhat clean failed." -ForegroundColor Red
    exit 1
}

# 2. Compile
Write-Host "`n[2/5] Compiling contract..." -ForegroundColor Yellow
npx hardhat compile

if ($LASTEXITCODE -ne 0) {
    Write-Host "Hardhat compile failed." -ForegroundColor Red
    exit 1
}

# 3. Start Hardhat node in a new terminal
Write-Host "`n[3/5] Starting Hardhat Local node..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$blockchain'; npx hardhat node"
)

# Wait for RPC to become available
Write-Host "Waiting for Hardhat RPC..." -ForegroundColor DarkYellow

$maxAttempts = 30
$connected = $false

for ($i = 1; $i -le $maxAttempts; $i++) {
    try {
        $response = Invoke-WebRequest `
            -Uri "http://127.0.0.1:8545" `
            -Method Post `
            -ContentType "application/json" `
            -Body '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' `
            -ErrorAction Stop

        if ($response.StatusCode -eq 200) {
            $connected = $true
            break
        }
    }
    catch {
        Start-Sleep -Seconds 1
    }
}

if (-not $connected) {
    Write-Host "Hardhat RPC did not start." -ForegroundColor Red
    exit 1
}

Write-Host "Hardhat RPC is ready." -ForegroundColor Green

# 4. Deploy contract and capture output
Write-Host "`n[4/5] Deploying RoomBooking..." -ForegroundColor Yellow

Set-Location $blockchain

$deployOutput = npx hardhat run scripts/deploy.js --network localhost 2>&1

$deployOutput | ForEach-Object {
    Write-Host $_
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment failed." -ForegroundColor Red
    exit 1
}

# Try to find deployed address
$contractAddress = $null

foreach ($line in $deployOutput) {
    if ($line -match "0x[a-fA-F0-9]{40}") {
        $contractAddress = $matches[0]
        break
    }
}

if (-not $contractAddress) {
    Write-Host "Could not find deployed contract address." -ForegroundColor Red
    Write-Host "Check deploy.js output above." -ForegroundColor Red
    exit 1
}

Write-Host "`nContract deployed at:" -ForegroundColor Green
Write-Host $contractAddress -ForegroundColor Cyan

# 5. Update frontend .env
Write-Host "`n[5/5] Updating frontend .env..." -ForegroundColor Yellow

if (-not (Test-Path $envFile)) {
    New-Item -ItemType File -Path $envFile -Force | Out-Null
}

$envContent = Get-Content $envFile -Raw -ErrorAction SilentlyContinue

if ($null -eq $envContent) {
    $envContent = ""
}

if ($envContent -match "(?m)^VITE_CONTRACT_ADDRESS_LOCAL=.*$") {
    $envContent = [regex]::Replace(
        $envContent,
        "(?m)^VITE_CONTRACT_ADDRESS_LOCAL=.*$",
        "VITE_CONTRACT_ADDRESS_LOCAL=$contractAddress"
    )
}
else {
    if ($envContent.Length -gt 0 -and -not $envContent.EndsWith("`n")) {
        $envContent += "`n"
    }

    $envContent += "VITE_CONTRACT_ADDRESS_LOCAL=$contractAddress`n"
}

Set-Content -Path $envFile -Value $envContent

Write-Host ".env updated successfully." -ForegroundColor Green
Write-Host "VITE_CONTRACT_ADDRESS_LOCAL=$contractAddress" -ForegroundColor Cyan

# Start frontend
Write-Host "`nStarting frontend..." -ForegroundColor Yellow

Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-Command",
    "cd '$frontend'; npm run dev"
)

Write-Host "`n========================================" -ForegroundColor Green
Write-Host " Everything is ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Network : Hardhat Local"
Write-Host "RPC     : http://127.0.0.1:8545"
Write-Host "Chain ID: 31337"
Write-Host "Contract: $contractAddress"
Write-Host "Frontend: npm run dev"
Write-Host "========================================" -ForegroundColor Green
```

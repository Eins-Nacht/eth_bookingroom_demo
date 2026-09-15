```powershell
$ErrorActionPreference = "Stop"

# ==========================================
# Hotel Booking - Local Development Setup
# ==========================================

$ProjectRoot = "C:\Users\sheeg\Downloads\spn\hotel-booking"
$BlockchainPath = "$ProjectRoot\blockchain"
$FrontendPath = "$ProjectRoot\frontend"
$FrontendEnv = "$FrontendPath\.env"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "    Hotel Booking Local Development     " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ==========================================
# Check folders
# ==========================================

if (-not (Test-Path $BlockchainPath)) {
    Write-Host "ERROR: Blockchain folder not found." -ForegroundColor Red
    Write-Host $BlockchainPath
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path $FrontendPath)) {
    Write-Host "ERROR: Frontend folder not found." -ForegroundColor Red
    Write-Host $FrontendPath
    Read-Host "Press Enter to exit"
    exit 1
}

if (-not (Test-Path "$BlockchainPath\scripts\deploy.js")) {
    Write-Host "ERROR: deploy.js not found." -ForegroundColor Red
    Write-Host "$BlockchainPath\scripts\deploy.js"
    Read-Host "Press Enter to exit"
    exit 1
}

# ==========================================
# 1. Start Hardhat Node
# ==========================================

Write-Host "[1/5] Starting Hardhat Local Node..." -ForegroundColor Yellow

Start-Process powershell.exe `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$BlockchainPath'; npx hardhat node"

Write-Host "Hardhat node terminal opened." -ForegroundColor Green
Write-Host "Waiting for RPC port 8545..." -ForegroundColor Yellow

$maxAttempts = 30
$attempt = 0
$nodeReady = $false

while ($attempt -lt $maxAttempts) {

    Start-Sleep -Seconds 1
    $attempt++

    try {
        $connection = Test-NetConnection `
            -ComputerName "127.0.0.1" `
            -Port 8545 `
            -WarningAction SilentlyContinue

        if ($connection.TcpTestSucceeded) {
            $nodeReady = $true
            break
        }
    }
    catch {
        # Keep waiting
    }

    Write-Host "." -NoNewline
}

Write-Host ""

if (-not $nodeReady) {
    Write-Host "ERROR: Hardhat node did not start within 30 seconds." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Hardhat node is ready." -ForegroundColor Green
Write-Host ""

# ==========================================
# 2. Deploy Contract
# ==========================================

Write-Host "[2/5] Deploying RoomBooking contract..." -ForegroundColor Yellow
Write-Host ""

Set-Location $BlockchainPath

$deployOutput = npx hardhat run scripts/deploy.js --network localhost 2>&1

$deployExitCode = $LASTEXITCODE

# Show deployment output
$deployOutput | ForEach-Object {
    Write-Host $_
}

if ($deployExitCode -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Contract deployment failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""

# ==========================================
# 3. Extract Contract Address
# ==========================================

Write-Host "[3/5] Reading deployed contract address..." -ForegroundColor Yellow

$contractAddress = $null

foreach ($line in $deployOutput) {

    if ($line -match "Deployed contract address:\s*(0x[a-fA-F0-9]{40})") {
        $contractAddress = $Matches[1]
        break
    }

    if ($line -match "RoomBooking deployed to:\s*(0x[a-fA-F0-9]{40})") {
        $contractAddress = $Matches[1]
        break
    }
}

if (-not $contractAddress) {
    Write-Host ""
    Write-Host "ERROR: Could not find contract address." -ForegroundColor Red
    Write-Host ""
    Write-Host "Expected something like:" -ForegroundColor Yellow
    Write-Host "Deployed contract address: 0x..."
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Contract Address:" -ForegroundColor Green
Write-Host $contractAddress -ForegroundColor Cyan
Write-Host ""

# ==========================================
# 4. Update Frontend .env
# ==========================================

Write-Host "[4/5] Updating frontend .env..." -ForegroundColor Yellow

$envKey = "VITE_CONTRACT_ADDRESS_LOCAL"

if (Test-Path $FrontendEnv) {

    $envContent = Get-Content $FrontendEnv -Raw

    $escapedKey = [regex]::Escape($envKey)

    $pattern = "(?m)^\s*$escapedKey\s*=.*$"

    if ($envContent -match $pattern) {

        $newEnvContent = [regex]::Replace(
            $envContent,
            $pattern,
            "$envKey=$contractAddress"
        )

    } else {

        $separator = if ($envContent.EndsWith("`n")) {
            ""
        } else {
            "`r`n"
        }

        $newEnvContent =
            $envContent +
            $separator +
            "$envKey=$contractAddress`r`n"
    }

    Set-Content `
        -Path $FrontendEnv `
        -Value $newEnvContent `
        -NoNewline

}
else {

    Set-Content `
        -Path $FrontendEnv `
        -Value "$envKey=$contractAddress`r`n"
}

Write-Host ".env updated successfully." -ForegroundColor Green
Write-Host ""

# ==========================================
# 5. Start Frontend
# ==========================================

Write-Host "[5/5] Starting frontend..." -ForegroundColor Yellow

Start-Process powershell.exe `
    -ArgumentList "-NoExit", "-Command", "Set-Location '$FrontendPath'; npm run dev"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "             SETUP COMPLETE             " -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Hardhat Local" -ForegroundColor White
Write-Host "Chain ID: 31337" -ForegroundColor White
Write-Host "RPC: http://127.0.0.1:8545" -ForegroundColor White
Write-Host ""

Write-Host "Contract Address:" -ForegroundColor White
Write-Host $contractAddress -ForegroundColor Cyan
Write-Host ""

Write-Host "Frontend .env:" -ForegroundColor White
Write-Host $FrontendEnv -ForegroundColor Cyan
Write-Host ""

Write-Host "VITE_CONTRACT_ADDRESS_LOCAL=$contractAddress" -ForegroundColor Yellow
Write-Host ""

Write-Host "Frontend development server is starting..." -ForegroundColor Green
Write-Host ""
Write-Host "Keep the Hardhat Node terminal running while testing." -ForegroundColor Yellow
Write-Host "Closing the Hardhat Node will reset the local blockchain." -ForegroundColor Yellow
Write-Host ""

Read-Host "Press Enter to close this setup window"
```

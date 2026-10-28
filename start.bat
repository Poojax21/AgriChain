@echo off
setlocal
cd /d %~dp0
echo ===============================================
echo  AgriChain - Starting full stack
echo  Root: %CD%
echo ===============================================

REM 0. Env file
if not exist .env (
  echo [1/6] Creating .env from .env.example...
  copy /Y .env.example .env >nul
) else (
  echo [1/6] .env exists, skipping.
)

REM 1. Install deps if missing
if not exist contracts\node_modules (
  echo [2/6] Installing contracts deps...
  pushd contracts
  call npm install
  popd
) else ( echo [2/6] contracts deps OK. )
if not exist backend\node_modules (
  echo [3/6] Installing backend deps...
  pushd backend
  call npm install
  popd
) else ( echo [3/6] backend deps OK. )
if not exist frontend\node_modules (
  echo [4/6] Installing frontend deps...
  pushd frontend
  call npm install
  popd
) else ( echo [4/6] frontend deps OK. )

REM Python AI deps (best effort)
echo [5/6] Checking Python AI deps...
C:\Users\Hi\AppData\Local\Programs\Python\Python314\python.exe -c "import fastapi, uvicorn, web3, eth_account, torch, torchvision" 2>nul
if errorlevel 1 (
  echo  Installing missing Python packages...
  C:\Users\Hi\AppData\Local\Programs\Python\Python314\python.exe -m pip install -r ai-service\requirements.txt
) else ( echo  Python deps OK. )

if not exist ai-service\models\fruitnet_mobilenet_v3_small.pth (
  echo  ERROR: Trained FruitNet model checkpoint is missing.
  echo  Run ai-service\download_fruitnet.py and ai-service\train_fruitnet.py as documented in ai-service\README.md.
  pause
  exit /b 1
)

REM 2. Start persistent local chain (disk-backed: lots/orders/escrows survive restarts)
echo [6/6] Starting services in new windows...
curl -s -m 3 http://127.0.0.1:8545 -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}" | findstr "result" >nul
if %errorlevel%==0 (
  echo  Local chain already running on :8545 — reusing it (never start a second one; LevelDB locks the data folder).
) else (
  start "AgriChain-Chain" cmd /k "cd /d %~dp0contracts && node ganache-server.js"
  echo  Waiting 10s for local chain...
  timeout /t 10 /nobreak >nul
)

REM 3. Deploy contracts only on first boot (skip when chain already has them)
echo  Checking on-chain deployment...
pushd contracts
for /f %%v in ('node scripts\check-deployed.js') do set DEPLOY_STATE=%%v
if "%DEPLOY_STATE%"=="REUSE" (
  echo  Contracts already on-chain — reusing (lots, orders and escrows preserved).
) else (
  echo  Deploying contracts to localhost...
  call npx hardhat run scripts/deploy.js --network localhost
)
popd

REM 4. Start AI, backend, frontend
REM NOTE: AI runs on 8001 on this machine — port 8000 is held by a dead
REM process that answers 404 to everything (no such PID; survives taskkill).
REM Backend reads AI_SERVICE_URL from root .env (set to :8001 there).
REM After a reboot, if :8000 is free again, you may switch both back.
start "AgriChain-AI" cmd /k "cd /d %~dp0ai-service && C:\Users\Hi\AppData\Local\Programs\Python\Python314\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001"
start "AgriChain-Backend" cmd /k "cd /d %~dp0backend && node server.js"
start "AgriChain-Frontend" cmd /k "cd /d %~dp0frontend && npx vite --port 3000 --host 127.0.0.1"

echo.
echo ===============================================
echo  All services launched:
echo   Hardhat  http://127.0.0.1:8545
echo   AI       http://127.0.0.1:8001/health
echo   Backend  http://localhost:5000/health
echo   Frontend http://127.0.0.1:3000
echo  Close the popup windows to stop each service.
echo ===============================================
pause

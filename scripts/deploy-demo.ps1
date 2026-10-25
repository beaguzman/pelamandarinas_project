<#
  deploy-demo.ps1 - Despliega el contrato Cascada y carga los datos de la demo.

  Uso (desde la raiz del proyecto):
    .\scripts\deploy-demo.ps1                     # futurenet (por defecto)
    .\scripts\deploy-demo.ps1 -Network testnet
    .\scripts\deploy-demo.ps1 -SkipBuild          # no recompila el wasm

  Si PowerShell bloquea el script:
    powershell -ExecutionPolicy Bypass -File .\scripts\deploy-demo.ps1

  Al terminar escribe demo-config.json con todo lo que necesita el frontend.
#>
param(
    [ValidateSet("futurenet", "testnet", "local")]
    [string]$Network = "futurenet",
    [string]$Alias = "cascada",
    [switch]$SkipBuild
)

# "Continue": stellar escribe mensajes informativos por stderr; los errores
# reales se detectan con $LASTEXITCODE.
$ErrorActionPreference = "Continue"

$Networks = @{
    futurenet = @{ rpc = "https://rpc-futurenet.stellar.org:443"; passphrase = "Test SDF Future Network ; October 2022" }
    testnet   = @{ rpc = "https://soroban-testnet.stellar.org";   passphrase = "Test SDF Network ; September 2015" }
    local     = @{ rpc = "http://localhost:8000/rpc";             passphrase = "Standalone Network ; February 2017" }
}

$Accounts = @("cliente", "contratista", "sub1", "sub2")
$Wasm = "target/wasm32v1-none/release/cascada.wasm"

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }

# 1 XLM = 10.000.000 unidades (7 decimales)
function Xlm($amount) { return [string]([long]([decimal]$amount * 10000000)) }

# Ejecuta stellar con una lista de argumentos y para si falla.
# Devuelve la ultima linea de la salida estandar (el resultado).
function Run($argList) {
    $out = & stellar @argList
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR ejecutando: stellar $($argList -join ' ')" -ForegroundColor Red
        exit 1
    }
    if ($null -eq $out) { return "" }
    return ([string](@($out)[-1])).Trim()
}

function Invoke-Cascada($source, $fnArgs) {
    $base = @("contract", "invoke", "--id", $Alias, "--source-account", $source, "--network", $Network, "--")
    return Run ($base + $fnArgs)
}

# Hash de ejemplo (en la app real es el SHA-256 del PDF de la factura)
function Fake-Hash($text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

# ---------------------------------------------------------------------------
Step "Red: $Network"

Step "1/6 Cuentas"
foreach ($acc in $Accounts) {
    & stellar keys address $acc 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   creando $acc"
        Run @("keys", "generate", $acc, "--network", $Network) | Out-Null
    }
    # Si la cuenta ya tiene saldo, friendbot puede dar error: se ignora.
    & stellar keys fund $acc --network $Network 2>$null | Out-Null
    $addr = Run @("keys", "address", $acc)
    Write-Host "   ${acc}: $addr"
}

Step "2/6 Token (XLM nativo via SAC)"
$TokenId = Run @("contract", "id", "asset", "--asset", "native", "--network", $Network)
Write-Host "   token: $TokenId"

if (-not $SkipBuild) {
    Step "3/6 Compilando contrato"
    Run @("contract", "build", "--package", "cascada") | Out-Null
} else {
    Step "3/6 Compilacion omitida (-SkipBuild)"
}

Step "4/6 Desplegando contrato"
$ContractId = Run @("contract", "deploy", "--wasm", $Wasm, "--source-account", "contratista",
    "--network", $Network, "--alias", $Alias, "--", "--token", $TokenId)
Write-Host "   contrato: $ContractId"

Step "5/6 Datos de demo"
$projectId = Invoke-Cascada "contratista" @("create_project", "--client", "cliente", "--contractor", "contratista")
Write-Host "   proyecto ${projectId} creado (cliente -> contratista)"

Invoke-Cascada "contratista" @("add_subcontractor", "--project_id", $projectId, "--sub", "sub1", "--bps", "3000") | Out-Null
Write-Host "   sub1 anadida (30%)"
Invoke-Cascada "contratista" @("add_subcontractor", "--project_id", $projectId, "--sub", "sub2", "--bps", "2000") | Out-Null
Write-Host "   sub2 anadida (20%)"

# Deudas cruzadas para la compensacion: sub1 -> contratista 50 XLM, contratista -> sub1 20 XLM
$inv1 = Invoke-Cascada "sub1" @("propose_invoice", "--project_id", $projectId, "--issuer", "sub1",
    "--payer", "contratista", "--amount", (Xlm 50), "--doc_hash", (Fake-Hash "factura-sub1-001"))
Invoke-Cascada "contratista" @("accept_invoice", "--invoice_id", $inv1) | Out-Null
Write-Host "   factura ${inv1}: sub1 cobra 50 XLM al contratista (aceptada)"

$inv2 = Invoke-Cascada "contratista" @("propose_invoice", "--project_id", $projectId, "--issuer", "contratista",
    "--payer", "sub1", "--amount", (Xlm 20), "--doc_hash", (Fake-Hash "factura-contratista-001"))
Invoke-Cascada "sub1" @("accept_invoice", "--invoice_id", $inv2) | Out-Null
Write-Host "   factura ${inv2}: contratista cobra 20 XLM a sub1 (aceptada) -> neto 30 XLM"

# Factura pendiente para aceptarla en directo durante la demo
$inv3 = Invoke-Cascada "sub2" @("propose_invoice", "--project_id", $projectId, "--issuer", "sub2",
    "--payer", "contratista", "--amount", (Xlm 15), "--doc_hash", (Fake-Hash "factura-sub2-001"))
Write-Host "   factura ${inv3}: sub2 cobra 15 XLM al contratista (PENDIENTE de aceptar)"

# Un pago en cascada para que haya historial
Invoke-Cascada "cliente" @("release", "--project_id", $projectId, "--payer", "cliente", "--amount", (Xlm 100)) | Out-Null
Write-Host "   pago en cascada: cliente paga 100 XLM -> sub1 30, sub2 20, contratista 50"

Step "6/6 Guardando demo-config.json"
$addresses = [ordered]@{}
foreach ($acc in $Accounts) { $addresses[$acc] = Run @("keys", "address", $acc) }

$config = [ordered]@{
    network           = $Network
    rpcUrl            = $Networks[$Network].rpc
    networkPassphrase = $Networks[$Network].passphrase
    contractId        = $ContractId
    tokenId           = $TokenId
    projectId         = [int]$projectId
    accounts          = $addresses
    deployedAt        = (Get-Date).ToString("s")
}
$json = $config | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "demo-config.json"), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Listo. Contrato $ContractId en $Network" -ForegroundColor Green
Write-Host "Configuracion para el frontend: demo-config.json"

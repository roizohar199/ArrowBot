$ErrorActionPreference = 'Stop'
$workspacePath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtimePath = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1112-611-0_26.1112.611.0_x64__3k8sg7r9htsxt\dependencies'
$chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$artifactDirectory = Join-Path $workspacePath 'output\manual'
$temporaryDirectory = Join-Path $workspacePath 'tmp\pdfs'
$null = New-Item -ItemType Directory -Path $temporaryDirectory -Force
$ownedProfile = Join-Path $temporaryDirectory ('arrow-manual-headless-' + [Guid]::NewGuid().ToString('N'))
$htmlPath = Join-Path $artifactDirectory 'Arrow_Operating_Manual_HE.html'
$pdfPath = Join-Path $artifactDirectory 'Arrow_Operating_Manual_HE.pdf'
$htmlUri = [Uri]::new($htmlPath).AbsoluteUri
$chromeArguments = @('--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer', '--allow-file-access-from-files', ('--user-data-dir="' + $ownedProfile + '"'), ('--print-to-pdf="' + $pdfPath + '"'), ('"' + $htmlUri + '"'))
# This fresh profile belongs only to this artifact job; no user browser profile,
# tab, extension, login, cookies or trading UI is read or controlled.
$renderProcess = Start-Process -FilePath $chromePath -ArgumentList $chromeArguments -PassThru -WindowStyle Hidden
if (-not $renderProcess.WaitForExit(60000)) { Stop-Process -Id $renderProcess.Id -Force; throw 'Owned headless PDF renderer exceeded sixty seconds.' }
if (-not (Test-Path -LiteralPath $pdfPath)) { throw 'PDF renderer did not produce the expected artifact.' }
$popplerPath = Join-Path $runtimePath 'native\poppler\Library\bin\pdftoppm.exe'
$pagePrefix = Join-Path $temporaryDirectory 'arrow-manual-page'
& $popplerPath -png -r 110 $pdfPath $pagePrefix
if ($LASTEXITCODE -ne 0) { throw 'Poppler could not render the PDF pages.' }
Write-Output $pdfPath
Get-ChildItem -LiteralPath $temporaryDirectory -Filter 'arrow-manual-page-*.png' | Select-Object -ExpandProperty FullName

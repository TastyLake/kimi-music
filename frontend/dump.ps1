$outputFile = "frontend_dump.txt"
$searchPaths = @("app", "components", "lib", "store")
$rootFiles = @("tailwind.config.js", "postcss.config.js", "next.config.js", "package.json")

# Очищаем или создаем файл с кодировкой UTF-8
[System.IO.File]::WriteAllText($outputFile, "=== FRONTEND CODE DUMP ===`n", [System.Text.Encoding]::UTF8)

# Собираем корневые конфиги
foreach ($file in $rootFiles) {
    if (Test-Path $file) {
        [System.IO.File]::AppendAllText($outputFile, "`n`n====================`nFILE: $file`n====================`n", [System.Text.Encoding]::UTF8)
        $content = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
        [System.IO.File]::AppendAllText($outputFile, $content, [System.Text.Encoding]::UTF8)
    }
}

# Собираем файлы из папок
foreach ($dir in $searchPaths) {
    if (Test-Path $dir) {
        $files = Get-ChildItem -Path $dir -Recurse -Include *.tsx, *.ts, *.js, *.css
        foreach ($f in $files) {
            $relativePath = $f.FullName.Replace((Get-Location).Path + "\", "")
            [System.IO.File]::AppendAllText($outputFile, "`n`n====================`nFILE: $relativePath`n====================`n", [System.Text.Encoding]::UTF8)
            $content = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
            [System.IO.File]::AppendAllText($outputFile, $content, [System.Text.Encoding]::UTF8)
        }
    }
}

Write-Host "Done! File saved as $outputFile" -ForegroundColor Green
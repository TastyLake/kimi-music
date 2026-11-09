import os

# Настройки экспорта
ROOT_DIR = '.'
OUTPUT_FILE = 'project_context.txt'

# Исключения, чтобы не засорять вывод
IGNORE_DIRS = {'.git', 'node_modules', '.next', 'dist', 'build', '.vscode', 'venv', '__pycache__', 'out'}
IGNORE_FILES = {'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'project_context.txt'}
IGNORE_EXTS = {
    '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', # Изображения
    '.mp3', '.wav', '.mp4',                           # Медиа
    '.woff', '.woff2', '.ttf', '.eot',                # Шрифты
    '.pdf', '.zip', '.tar', '.gz', '.exe'             # Архивы и бинарники
}

def is_valid_file(file_name):
    if file_name in IGNORE_FILES: return False
    if any(file_name.endswith(ext) for ext in IGNORE_EXTS): return False
    return True

with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
    out.write("=== СТРУКТУРА ПРОЕКТА ===\n")
    for root, dirs, files in os.walk(ROOT_DIR):
        # Исключаем ненужные директории
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        
        level = root.replace(ROOT_DIR, '').count(os.sep)
        indent = ' ' * 4 * level
        out.write(f"{indent}{os.path.basename(root)}/\n")
        
        subindent = ' ' * 4 * (level + 1)
        for f in files:
            out.write(f"{subindent}{f}\n")

    out.write("\n\n=== ИСХОДНЫЙ КОД ===\n")
    for root, dirs, files in os.walk(ROOT_DIR):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        
        for file in files:
            if not is_valid_file(file):
                continue
                
            file_path = os.path.join(root, file)
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                out.write(f"\n\n--- ФАЙЛ: {file_path} ---\n\n")
                out.write(content)
            except Exception as e:
                out.write(f"\n\n--- ФАЙЛ: {file_path} (Пропущен: невозможно прочитать как текст) ---\n")

print(f"Готово! Данные сохранены в {OUTPUT_FILE}")

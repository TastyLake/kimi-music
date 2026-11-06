import os

# Имена папок, которые нужно полностью пропустить
EXCLUDE_DIRS = {
    'node_modules', '.git', '.next', 'dist', 'build', 'release', 
    'out', 'vendor', 'venv', '.venv', '__pycache__', '.idea', '.vscode'
}

# Разрешенные текстовые расширения файлов
ALLOWED_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.jsx', '.json', '.py', '.sql', 
    '.css', '.scss', '.html', '.md', '.env.example', '.yaml', '.yml', '.toml'
}

# Имя итогового файла
OUTPUT_FILE = 'codebase_for_ai.txt'

def is_text_file(filename):
    ext = os.path.splitext(filename)[1].lower()
    return ext in ALLOWED_EXTENSIONS or filename in {'Dockerfile', 'Makefile', '.gitignore'}

def pack_codebase(root_dir='.'):
    packed_count = 0
    
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_f:
        for root, dirs, files in os.walk(root_dir):
            # Исключаем ненужные директории «на лету»
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file in files:
                if file == OUTPUT_FILE or file == 'pack_code.py':
                    continue

                if is_text_file(file):
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, root_dir)

                    try:
                        with open(file_path, 'r', encoding='utf-8', errors='ignore') as in_f:
                            content = in_f.read()
                            out_f.write(f"=== FILE: {rel_path} ===\n\n")
                            out_f.write(content)
                            out_f.write("\n\n" + "="*40 + "\n\n")
                            packed_count += 1
                    except Exception as e:
                        print(f"Ошибка чтения {rel_path}: {e}")

    file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
    print(f"Успешно упаковано файлов: {packed_count}")
    print(f"Итоговый размер '{OUTPUT_FILE}': {file_size_mb:.2f} MB")

if __name__ == '__main__':
    pack_codebase()
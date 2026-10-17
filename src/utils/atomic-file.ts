import { copyFile, rename, writeFile } from 'node:fs/promises';

/**
 * Zapisuje plik atomowo: najpierw plik tymczasowy, potem rename (atomowy na tym samym
 * systemie plikow), wiec przerwany zapis nigdy nie zostawia uciętego pliku docelowego.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, filePath);
}

/**
 * Kopiuje uszkodzony plik obok oryginalu, zanim kolejny zapis go nadpisze.
 * Zwraca sciezke kopii albo null, gdy kopia sie nie udala.
 */
export async function backupCorruptFile(filePath: string): Promise<string | null> {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;

    try {
        await copyFile(filePath, backupPath);
        return backupPath;
    } catch {
        return null;
    }
}

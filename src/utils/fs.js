import { readdir, stat, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/**
 * Check if a path exists
 */
export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if path is a directory
 */
export async function isDirectory(filePath) {
  try {
    const s = await stat(filePath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if path is a file
 */
export async function isFile(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Read and parse a JSON file
 */
export async function readJSON(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write JSON to file, creating directories as needed
 */
export async function writeJSON(filePath, data, indent = 2) {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, indent) + '\n', 'utf-8');
}

/**
 * Write text to file, creating directories as needed
 */
export async function writeText(filePath, content) {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, content, 'utf-8');
}

/**
 * Append text to file
 */
export async function appendText(filePath, content) {
  await appendFile(filePath, content, 'utf-8');
}

/**
 * Create directory recursively if it doesn't exist
 */
export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

/**
 * List top-level directories in a path
 */
export async function listDirectories(parentPath) {
  if (!(await pathExists(parentPath))) return [];
  const entries = await readdir(parentPath);
  const dirs = [];
  for (const entry of entries) {
    const full = join(parentPath, entry);
    if (await isDirectory(full)) {
      dirs.push(entry);
    }
  }
  return dirs;
}

/**
 * List files matching a pattern in a directory
 */
export async function listFiles(parentPath, ext) {
  if (!(await pathExists(parentPath))) return [];
  const entries = await readdir(parentPath);
  return entries.filter((e) => (ext ? e.endsWith(ext) : true));
}

/**
 * Read text file content
 */
export async function readText(filePath) {
  return readFile(filePath, 'utf-8');
}

/**
 * Copy a file, creating destination directories
 */
export async function copyFile(src, dest) {
  await ensureDir(dirname(dest));
  const content = await readFile(src);
  await writeFile(dest, content);
}

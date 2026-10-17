import { message } from '../platform';

export async function copyFilePath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    await message('Could not copy the file path to the clipboard.', {
      title: 'Copy path',
      kind: 'error',
    });
  }
}

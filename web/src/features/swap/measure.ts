/** The size of a picture the customer picked, as the browser reads it; null when it cannot read the file as a picture. */
export async function measurePicture(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

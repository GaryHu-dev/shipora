export async function putPhoto(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer,
  contentType: string
): Promise<void> {
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
}

export async function getPhoto(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return await bucket.get(key);
}

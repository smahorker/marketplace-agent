import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

// Neon injects AWS_* for the branch's object storage; the SDK reads them from the environment.
const s3 = new S3Client({ forcePathStyle: true });
const BUCKET = "photos";

export async function putPhoto(key: string, body: Uint8Array, contentType: string) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getPhoto(key: string): Promise<Uint8Array> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return res.Body!.transformToByteArray();
}

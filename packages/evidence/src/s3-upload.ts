import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { readFile as fsReadFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceBundleManifest } from '@contractqa/core';

export interface UploadBundleInput {
  client: S3Client;
  bucket: string;
  keyPrefix: string;
  localDir: string;
  manifest: EvidenceBundleManifest;
  readFile?: (p: string) => Promise<Buffer>;
}

export interface UploadResult {
  uploaded: number;
  keys: string[];
}

export async function uploadBundleToS3(input: UploadBundleInput): Promise<UploadResult> {
  const read = input.readFile ?? fsReadFile;
  const keys: string[] = [];
  for (const f of input.manifest.files) {
    const body = await read(path.join(input.localDir, f.path));
    const key = `${input.keyPrefix}/${f.path}`;
    await input.client.send(new PutObjectCommand({ Bucket: input.bucket, Key: key, Body: body }));
    keys.push(key);
  }
  const manifestKey = `${input.keyPrefix}/manifest.json`;
  await input.client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: manifestKey,
      Body: Buffer.from(JSON.stringify(input.manifest, null, 2)),
      ContentType: 'application/json',
    }),
  );
  keys.push(manifestKey);
  return { uploaded: keys.length, keys };
}

import { api } from "./client";

export type MediaSignResult =
  | {
      enabled: false;
      message?: string;
      folder?: string;
    }
  | {
      enabled: true;
      cloud_name: string;
      api_key: string;
      timestamp: number;
      folder: string;
      signature: string;
    };

export type MediaOut = {
  id: string;
  cloudinary_public_id: string;
  resource_type: string;
  version: number;
  versions_meta: unknown[] | null;
  is_deleted: boolean;
  bird_id: string | null;
  shed_id?: string | null;
  flock_id?: string | null;
  vaccination_event_id?: string | null;
  created_at: string;
};

export async function signMediaUpload(opts: {
  shedId?: string | null;
  folderSuffix?: string;
}): Promise<MediaSignResult> {
  const { data } = await api.post("/media/sign", {
    shed_id: opts.shedId ?? null,
    folder_suffix: opts.folderSuffix ?? "general",
  });
  return data as MediaSignResult;
}

export async function registerMedia(input: {
  public_id: string;
  shed_id?: string | null;
  flock_id?: string | null;
  bird_id?: string | null;
  vaccination_event_id?: string | null;
  resource_type?: string;
  format?: string | null;
  version?: number;
  notes?: string | null;
}): Promise<MediaOut> {
  const { data } = await api.post("/media", {
    public_id: input.public_id,
    shed_id: input.shed_id ?? null,
    flock_id: input.flock_id ?? null,
    bird_id: input.bird_id ?? null,
    vaccination_event_id: input.vaccination_event_id ?? null,
    resource_type: input.resource_type ?? "image",
    format: input.format ?? null,
    version: input.version ?? 1,
    notes: input.notes ?? null,
  });
  return data as MediaOut;
}

export async function listMedia(opts?: {
  birdId?: string;
  vaccinationEventId?: string;
}): Promise<MediaOut[]> {
  const params: Record<string, string> = {};
  if (opts?.birdId) params.bird_id = opts.birdId;
  if (opts?.vaccinationEventId) params.vaccination_event_id = opts.vaccinationEventId;
  const { data } = await api.get("/media", { params });
  return data as MediaOut[];
}

/**
 * Upload a local image to Cloudinary using a signed payload from `/media/sign`.
 * Does not invent storage — requires `enabled: true` from the backend sign response.
 */
export function uploadSignedImageToCloudinary(
  sign: Extract<MediaSignResult, { enabled: true }>,
  file: { uri: string; mimeType: string; fileName: string },
  onProgress?: (ratio: number) => void,
): Promise<{ public_id: string; format?: string; version?: number }> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", {
      uri: file.uri,
      type: file.mimeType,
      name: file.fileName,
    } as unknown as Blob);
    form.append("api_key", sign.api_key);
    form.append("timestamp", String(sign.timestamp));
    form.append("signature", sign.signature);
    form.append("folder", sign.folder);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${sign.cloud_name}/image/upload`);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Cloudinary upload failed (${xhr.status}).`));
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as {
          public_id?: string;
          format?: string;
          version?: number;
        };
        if (!body.public_id) {
          reject(new Error("Cloudinary response missing public_id."));
          return;
        }
        resolve({
          public_id: body.public_id,
          format: body.format,
          version: body.version,
        });
      } catch {
        reject(new Error("Invalid Cloudinary upload response."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error uploading label photo."));
    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(event.loaded / event.total);
        }
      };
    }
    xhr.send(form);
  });
}

export class MediaStorageUnavailableError extends Error {
  constructor(message = "Photo storage is not configured on this server.") {
    super(message);
    this.name = "MediaStorageUnavailableError";
  }
}

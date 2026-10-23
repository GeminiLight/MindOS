import { z } from "zod";
// Existing Studio identities are slugs, including Chinese names. They are never file paths.
export const projectIdentity = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9\u4e00-\u9fa5]+(?:-[a-z0-9\u4e00-\u9fa5]+)*$/);

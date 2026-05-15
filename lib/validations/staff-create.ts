import { z } from "zod";

/**
 * Validation schema for creating a new staff user.
 *
 * Requirements:
 * - name: required, non-empty string (max 255 chars)
 * - email: optional but if provided must be valid email format
 * - phone: optional but if provided must be a non-empty string
 * - role: required, must be one of the allowed staff roles
 * - Custom validation: at least one of email or phone must be provided
 */
export const staffCreateSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(255, "Name is too long"),
    email: z
      .string()
      .email("Please enter a valid email address")
      .optional()
      .or(z.literal("")),
    phone: z.string().optional().or(z.literal("")),
    role: z.enum(["admin", "sales_rep", "support"]).describe("Role must be admin, sales_rep, or support"),
  })
  .refine((data) => data.email || data.phone, {
    message: "Please provide at least an email address or phone number",
    path: ["email"],
  });

export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

import { z } from 'zod';

const websiteField = z.string().optional();

export const contactSchema = z.object({
  email: z.email(),
  message: z.string().min(1).max(5000),
  source: z.string().max(128).optional(),
  locale: z.enum(['en', 'cs', 'sk']).optional(),
  website: websiteField,
});

export const newsletterSchema = z.object({
  email: z.email(),
  locale: z.enum(['en', 'cs', 'sk']).optional(),
  gdprConsent: z.literal(true),
  website: websiteField,
});

export type ContactInput = z.infer<typeof contactSchema>;
export type NewsletterInput = z.infer<typeof newsletterSchema>;

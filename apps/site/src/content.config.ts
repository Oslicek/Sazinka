import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    locale: z.enum(['en', 'cs', 'sk']),
    author: z.string().default('Ariadline Team'),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog };

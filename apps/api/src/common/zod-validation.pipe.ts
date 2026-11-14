import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ValidationIssue } from '@ota/contracts';
import type { z } from 'zod';

// Validates and transforms (trim, coerce, defaults) a request part against a Zod schema.
// Usage: @Query(new ZodValidationPipe(schema)) query: z.infer<typeof schema>
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        // Stable, client-friendly shape; Zod's raw issues carry internals (codes, inputs) we don't promise.
        issues: result.error.issues.map((issue): ValidationIssue => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

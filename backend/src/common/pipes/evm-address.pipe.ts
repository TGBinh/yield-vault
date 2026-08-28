import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Validate route params are plausible EVM addresses (0x + 40 hex chars).
 * Trả về 400 nếu không hợp lệ, tránh truyền thẳng path param vào SQL query.
 */
@Injectable()
export class EvmAddressPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (typeof value !== 'string' || !EVM_ADDRESS_REGEX.test(value)) {
      throw new BadRequestException(
        `Invalid EVM address for parameter "${metadata.data}"`,
      );
    }
    return value.toLowerCase();
  }
}

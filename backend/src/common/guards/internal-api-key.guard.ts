import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/// Vault Security Audit - Critical C3: POST /policy/evaluate không có auth nào, nên bất
/// kỳ ai cũng "đốt" được slot cooldown rebalance (xem PolicyService.tryClaimRebalanceSlot).
/// Guard này chặn route đó lại bằng 1 shared secret nội bộ (giữa Keeper Bot/vận hành
/// viên và backend) - không phải end-user auth, chỉ là internal service-to-service key.
/// Fail-closed có chủ đích: nếu INTERNAL_API_KEY chưa được cấu hình, route bị khoá hoàn
/// toàn thay vì mở public - production PHẢI set biến này trước khi dùng route ghi này.
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_KEY');
    if (!expected) {
      throw new UnauthorizedException('INTERNAL_API_KEY is not configured on the server');
    }

    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const provided = request.headers['x-api-key'];
    if (provided !== expected) {
      throw new UnauthorizedException('Missing or invalid x-api-key header');
    }

    return true;
  }
}

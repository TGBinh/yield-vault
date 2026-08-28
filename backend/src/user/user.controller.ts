import { Controller, Get, Param } from '@nestjs/common';
import { EvmAddressPipe } from '../common/pipes/evm-address.pipe';
import { UserService } from './user.service';
import { UserPositionsDto } from './dto/user-position.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':address/positions')
  async getPositions(
    @Param('address', EvmAddressPipe) address: string,
  ): Promise<UserPositionsDto> {
    return this.userService.getPositions(address);
  }
}

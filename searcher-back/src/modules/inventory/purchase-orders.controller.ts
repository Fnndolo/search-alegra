import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  HttpCode,
  HttpException,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  BadRequestException,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../entities/user.entity';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  CancelPurchaseOrderDto,
  ListPurchaseOrdersQuery,
  CreateWarehouseDto,
} from './entities/dto/create-purchase-order.dto';

// Logs non-HttpException errors here (their only touchpoint before leaving the controller layer),
// then rethrows the ORIGINAL error untouched — flattening it into a bare 500 HttpException here
// would strip its real type (QueryFailedError, axios error, ...) before AllExceptionsFilter ever
// gets a chance to decode it into a real status/message.
function rethrow(err: unknown, logger: Logger, context: string): never {
  if (!(err instanceof HttpException)) {
    const msg = (err as any)?.message ?? 'Internal server error';
    logger.error(`[PurchaseOrdersController] ${context}: ${msg}`, (err as any)?.stack);
  }
  throw err;
}

function parseOrderId(raw: string): number {
  const id = parseInt(raw, 10);
  if (isNaN(id)) throw new BadRequestException('Invalid order id');
  return id;
}

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class PurchaseOrdersController {
  private readonly logger = new Logger(PurchaseOrdersController.name);

  constructor(private readonly service: PurchaseOrdersService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async findAll(@Query() query: ListPurchaseOrdersQuery) {
    try {
      return await this.service.findAll(query);
    } catch (err) {
      rethrow(err, this.logger, 'findAll');
    }
  }

  // Must be declared before ':id' routes so 'warehouses' is not treated as an id param
  @Post('warehouses')
  @Roles(UserRole.ADMIN)
  async createWarehouse(@Body() dto: CreateWarehouseDto) {
    try {
      return await this.service.createWarehouse(dto);
    } catch (err) {
      rethrow(err, this.logger, 'createWarehouse');
    }
  }

  // Static routes — must be before ':id'
  @Get('sync-logs')
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async getSyncLogs() {
    try {
      return await this.service.getSyncLogs();
    } catch (err) {
      rethrow(err, this.logger, 'getSyncLogs');
    }
  }

  @Get('sync-count')
  @Roles(UserRole.ADMIN)
  async getSyncCount() {
    try {
      return await this.service.getSyncCount();
    } catch (err) {
      rethrow(err, this.logger, 'getSyncCount');
    }
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async findOne(@Param('id') id: string) {
    try {
      return await this.service.findOne(parseOrderId(id));
    } catch (err) {
      rethrow(err, this.logger, 'findOne');
    }
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async create(@Body() dto: CreatePurchaseOrderDto, @Request() req: any) {
    try {
      return await this.service.create(dto, req.user?.username ?? null);
    } catch (err) {
      rethrow(err, this.logger, 'create');
    }
  }

  @Put(':id')
  @Roles(UserRole.ADMIN)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @Request() req: any,
  ) {
    try {
      return await this.service.update(parseOrderId(id), dto, req.user?.username ?? null);
    } catch (err) {
      rethrow(err, this.logger, 'update');
    }
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async deleteDraft(@Param('id') id: string) {
    try {
      return await this.service.deleteDraft(parseOrderId(id));
    } catch (err) {
      rethrow(err, this.logger, 'deleteDraft');
    }
  }

  @Post(':id/submit')
  @HttpCode(200)
  @Roles(UserRole.ADMIN, UserRole.FACTURACION)
  async submitDraft(@Param('id') id: string, @Request() req: any) {
    try {
      return await this.service.submitDraft(parseOrderId(id), req.user?.username ?? null);
    } catch (err) {
      rethrow(err, this.logger, 'submitDraft');
    }
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelPurchaseOrderDto,
    @Request() req: any,
  ) {
    try {
      return await this.service.cancel(parseOrderId(id), dto, req.user?.username ?? null);
    } catch (err) {
      rethrow(err, this.logger, 'cancel');
    }
  }

  @Post(':id/retry-inventory')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  async retryInventory(@Param('id') id: string, @Request() req: any) {
    try {
      return await this.service.retryInventory(parseOrderId(id), req.user?.username ?? null);
    } catch (err) {
      rethrow(err, this.logger, 'retryInventory');
    }
  }
}

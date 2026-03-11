import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicBillingService } from './electronic-billing.service';

describe('ElectronicBillingService', () => {
  let service: ElectronicBillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ElectronicBillingService],
    }).compile();

    service = module.get<ElectronicBillingService>(ElectronicBillingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

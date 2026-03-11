import { Test, TestingModule } from '@nestjs/testing';
import { ElectronicBillingController } from './electronic-billing.controller';

describe('ElectronicBillingController', () => {
  let controller: ElectronicBillingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ElectronicBillingController],
    }).compile();

    controller = module.get<ElectronicBillingController>(ElectronicBillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});

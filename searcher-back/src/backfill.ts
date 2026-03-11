import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { InvoicesService } from './invoices/invoices.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { Repository } from 'typeorm';

async function bootstrap() {
    console.log('Starting backfill process...');
    const app = await NestFactory.createApplicationContext(AppModule);
    const invoiceRepo = app.get<Repository<Invoice>>(getRepositoryToken(Invoice));

    // As in the searcher-back codebase, the invoice service might have fetchAllPaymentBankAccounts 
    // private. Let's cast it to any to bypass modifier for this script.
    const invoicesService = app.get(InvoicesService) as any;

    const sinceDate = new Date('2026-01-01T00:00:00.000Z');

    console.log(`Fetching invoices since ${sinceDate.toISOString()} from database...`);
    const invoices = await invoiceRepo.createQueryBuilder('invoice')
        .where('invoice.date >= :sinceDate', { sinceDate })
        .andWhere('invoice."paymentBankAccounts" IS NULL') // Optional optimization
        .getMany();

    console.log(`Found ${invoices.length} invoices to backfill.`);

    let processed = 0;
    let updated = 0;
    for (const invoice of invoices) {
        if (!invoice.paymentBankAccounts || invoice.paymentBankAccounts.length === 0) {
            if (invoice.data.status === 'void' || invoice.data.status === 'draft') continue;

            const payments = invoice.data.payments || [];
            if (payments.length > 0) {
                try {
                    const accounts = await invoicesService.fetchAllPaymentBankAccounts(invoice.store, invoice.data);
                    if (accounts && accounts.length > 0) {
                        invoice.paymentBankAccounts = accounts;
                        invoice.bankAccountName = accounts[0].bankName;
                        await invoiceRepo.save(invoice);
                        updated++;
                    }
                } catch (e) {
                    console.error(`Error processing invoice ${invoice.id} store ${invoice.store}:`, e.message);
                }
            }
        }
        processed++;
        if (processed % 50 === 0) {
            console.log(`Processed ${processed} of ${invoices.length}. Updated: ${updated}`);
        }
        // Small delay to prevent hitting Alegra API rate limits too hard
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    console.log(`Backfill completed. Processed: ${processed}, Updated: ${updated}`);
    await app.close();
}

bootstrap();

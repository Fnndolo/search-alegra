export interface WebhookSubscription {
    url: string;
    events: WebhookEvent[];
    status: 'active' | 'inactive';
}

export type WebhookEvent = 
    | 'new-invoice'    // Nueva factura creada
    | 'edit-invoice'   // Factura actualizada
    | 'delete-invoice' // Factura eliminada
    | 'new-bill'      // Nueva factura de compra creada
    | 'edit-bill'     // Factura de compra actualizada
    | 'delete-bill';   // Factura de compra eliminada

export interface WebhookPayload {
    subject: string;
    message: {
        bill?: {
            id: string;
            [key: string]: any;
        };
        invoice?: {
            id: string;
            [key: string]: any;
        };
    };
}
// PriceFeed.service.ts

import { ServiceAbstract } from "./abstract.service";

/* ######################################################### */


export class PriceFeed extends ServiceAbstract {
    private solPrice: number = 0;  // Prix en USD
    private readonly API_URL = 'https://api-v3.raydium.io/mint/price?mints=So11111111111111111111111111111111111111112';
    private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';


    start() {
        if (this.status !== 'stopped') return;
        super.start();

        // Premier appel
        this.updatePrice();

        // Appel régulier...
        if (! this.intervals.updatePrice) {
            this.intervals.updatePrice = setInterval(() => this.updatePrice(), 60_000);
        }

        super.started();
    }



    getSolPrice(): number {
        return this.solPrice;
    }


    async updatePrice(): Promise<void> {

        try {
            const response = await fetch(this.API_URL);
            const data = await response.json();
 
            if (data.success && data.data[this.SOL_MINT]) {
                this.solPrice = parseFloat(data.data[this.SOL_MINT]);
                //console.log(`Updated SOL price: $${this.solPrice}`);
            }

            this.emit('log', `Updated SOL price: $${this.solPrice}`);
            this.emit('price_updated');

        } catch (err: any) {
            console.error('Error fetching SOL price:', err);
        }
    }

}


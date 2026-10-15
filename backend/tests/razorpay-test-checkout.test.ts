import {expect,it} from 'vitest';
import {PricingRepository} from '../src/modules/pricing/pricing.repository.js';
import {calculateQuote} from '../src/modules/pricing/pricing-engine.js';
import {cinemaSimulationPolicy} from '../src/modules/pricing/cinema-simulation.js';
const environment={NODE_ENV:'development',DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:5432/cinehook_dev',REDIS_URL:'redis://127.0.0.1:6379',FRONTEND_ORIGIN:'http://localhost:5173',JWT_SECRET:'test-only-key-1234567890123456789012',DEV_RAZORPAY_TEST_CHECKOUT:'true',RAZORPAY_KEY_ID:'rzp_test_fixture',RAZORPAY_KEY_SECRET:'test-fixture-secret',RAZORPAY_WEBHOOK_SECRET:'test-webhook-secret-123456789012345678'};
it('simulated provider checkout needs explicit validated configuration and exact provider identity',()=>{
  expect(()=>new PricingRepository({} as any,'razorpay-test')).toThrow();
  expect(()=>new PricingRepository({} as any,'razorpay-test',{...environment,DEV_RAZORPAY_TEST_CHECKOUT:'false'})).toThrow();
  const pricing=new PricingRepository({} as any,'razorpay-test',environment);
  expect(()=>pricing.assertProvider('rzp_live_other')).toThrow();expect(()=>pricing.assertProvider('rzp_test_different')).toThrow();
  expect(()=>pricing.assertProvider(environment.RAZORPAY_KEY_ID)).not.toThrow();
});
it('runtime database identity must still match the configured test database, schema, role and port',async()=>{
  const pricing=new PricingRepository({} as any,'razorpay-test',environment);
  for(const identity of [{name:'cinehook',role:'fixture',schema:'public',port:5432},{name:'cinehook_dev',role:'fixture',schema:'private',port:5432},{name:'cinehook_dev',role:'other',schema:'public',port:5432},{name:'cinehook_dev',role:'fixture',schema:'public',port:55438}]){
    await expect(pricing.assertPaymentAllowed({$queryRaw:async()=>[identity]} as any,{simulated:true})).rejects.toMatchObject({code:'SIMULATED_PREVIEW_ONLY'});
  }
  await expect(pricing.assertPaymentAllowed({$queryRaw:async()=>[{name:'cinehook_dev',role:'fixture',schema:'public',port:5432}]} as any,{simulated:true})).resolves.toBeUndefined();
  const quote=calculateQuote([{id:'seat',price:25000}],'FIRST50',cinemaSimulationPolicy,new Date('2026-10-13'),'razorpay-test');
  expect(quote.simulated).toBe(true);expect(quote.policy.verified).toBe(false);expect(quote.paymentAllowed).toBe(true);expect(quote.totalPaise).toBe(13326);
});

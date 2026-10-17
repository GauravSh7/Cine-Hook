import {render,screen,waitFor} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {expect,it,vi} from 'vitest'
import {CheckoutPricing} from '../src/components/CheckoutPricing'
import {OffersPage} from '../src/pages/OffersPage'
const quote={version:1,label:'Order summary',couponCode:'FIRST50',subtotalPaise:40000,discountPaise:20000,discountedPaise:20000,ticketBasePaise:19048,admissionTaxPaise:952,feePaise:700,feeTaxPaise:126,totalPaise:20826,taxes:[{name:'CGST',rateBps:250,amountPaise:476},{name:'SGST',rateBps:250,amountPaise:476}],feeTaxes:[{name:'CGST',rateBps:900,amountPaise:63},{name:'SGST',rateBps:900,amountPaise:63}],frozen:false}
it('labels simulated tax bills and shows a zero coupon discount explicitly',async()=>{
  render(<CheckoutPricing quote={{...quote,simulated:true,paymentAllowed:false,couponCode:null,discountPaise:0}} busy={false} onCoupon={async()=>{}}/>);
  await userEvent.click(screen.getByText('Show Bill'));
  expect(screen.getByText('DEMO RECEIPT — NOT A TAX INVOICE')).toBeVisible();
  expect(screen.getByText('Coupon discount')).toBeVisible();
});
it('combines matching admission taxes and displays a genuinely waived fee as free',async()=>{
  render(<CheckoutPricing quote={{...quote,feeWaived:true,feeOriginalPaise:700,feePaise:0,feeTaxPaise:0,totalPaise:20000,taxes:[...quote.taxes,...quote.taxes],feeTaxes:[]}} busy={false} onCoupon={async()=>{}}/>);
  await userEvent.click(screen.getByText('Show Bill'));
  expect(screen.getByText('Free')).toBeVisible();expect(screen.getByText('₹7.00').tagName).toBe('DEL');
  expect(screen.getAllByText(/CGST.*included/)).toHaveLength(1);expect(screen.getAllByText(/SGST.*included/)).toHaveLength(1);
  expect(screen.queryByText('Platform-fee GST')).not.toBeInTheDocument();
  expect(screen.getByText(/CGST.*included/).parentElement).toHaveTextContent('₹9.52');expect(screen.getByText(/SGST.*included/).parentElement).toHaveTextContent('₹9.52');
  expect(screen.getByText(/GST rates may change/)).toBeVisible();
});
it('shows server bill amounts, included tax and fee without calculating another total',async()=>{
  render(<CheckoutPricing quote={quote} busy={false} onCoupon={async()=>{}}/>);await userEvent.click(screen.getByText('Show Bill'))
  expect(screen.getByText('₹208.26')).toBeVisible();expect(screen.getByText('Admission GST (included above)')).toBeVisible();expect(screen.getByText('₹7.00')).toBeVisible()
})
it('submits normalized coupon, permits removal and shows safe backend errors',async()=>{
  const apply=vi.fn(async(code:string|null)=>{if(code==='OTHER')throw new Error('This coupon is not valid.')})
  render(<CheckoutPricing quote={quote} busy={false} onCoupon={apply}/>);await userEvent.type(screen.getByLabelText('Coupon code'),' save10 ');await userEvent.click(screen.getByRole('button',{name:'Apply'}));expect(apply).toHaveBeenCalledWith('SAVE10')
  await userEvent.click(screen.getByRole('button',{name:'Remove'}));expect(apply).toHaveBeenCalledWith(null)
  await userEvent.clear(screen.getByLabelText('Coupon code'));await userEvent.type(screen.getByLabelText('Coupon code'),'OTHER');await userEvent.click(screen.getByRole('button',{name:'Apply'}));expect(await screen.findByRole('alert')).toHaveTextContent('This coupon is not valid.')
})
it('frozen or busy checkout disables coupon mutation',()=>{
  render(<CheckoutPricing quote={{...quote,frozen:true}} busy={false} onCoupon={async()=>{}}/>);expect(screen.getByLabelText('Coupon code')).toBeDisabled();expect(screen.getByRole('button',{name:'Remove'})).toBeDisabled()
})
it('shows approved coupons only in All and leaves payment-method categories empty',async()=>{
  render(<OffersPage/>);await userEvent.click(screen.getAllByRole('button',{name:'Get Code'})[0]!);expect(screen.getByText('FIRST50')).toBeVisible()
  await userEvent.click(screen.getByRole('tab',{name:'Debit Card'}));expect(screen.getByRole('tabpanel')).toHaveTextContent('No offers are available for Debit Card');expect(screen.queryByRole('button',{name:'Get Code'})).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab',{name:'All'}));await userEvent.click(screen.getByRole('button',{name:'Get Code'}));expect(screen.getByText('SAVE10')).toBeVisible()
  const copy=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});await userEvent.click(screen.getAllByRole('button',{name:'Copy Code'})[1]!);await waitFor(()=>expect(copy).toHaveBeenCalledWith('SAVE10'))
})

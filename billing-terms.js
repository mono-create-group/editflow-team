(function(root){
  'use strict';

  function parts(value){
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)return null;
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const check=new Date(Date.UTC(year,month-1,day));
    if(check.getUTCFullYear()!==year||check.getUTCMonth()!==month-1||check.getUTCDate()!==day)return null;
    return{year,month,day};
  }

  function shiftedMonth(year,month,offset){
    const value=new Date(Date.UTC(year,month-1+offset,1));
    return{year:value.getUTCFullYear(),month:value.getUTCMonth()+1};
  }

  function ymd(year,month,day){
    return`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  function monthEnd(year,month){
    return new Date(Date.UTC(year,month,0)).getUTCDate();
  }

  function forCompletedDelivery(completedDeliveryDate){
    const delivery=parts(completedDeliveryDate);
    if(!delivery)return null;
    const afterCutoff=delivery.day>25;
    const invoice=shiftedMonth(delivery.year,delivery.month,afterCutoff?1:0);
    const payment=shiftedMonth(delivery.year,delivery.month,afterCutoff?2:1);
    return Object.freeze({
      completedDeliveryDate:ymd(delivery.year,delivery.month,delivery.day),
      invoiceMonth:ymd(invoice.year,invoice.month,1).slice(0,7),
      invoiceAvailableOn:ymd(invoice.year,invoice.month,25),
      paymentDueDate:ymd(payment.year,payment.month,monthEnd(payment.year,payment.month)),
    });
  }

  const api=Object.freeze({forCompletedDelivery});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.EditflowBilling=api;
})(typeof window!=='undefined'?window:globalThis);

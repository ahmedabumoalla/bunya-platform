export const demoSeedVersion = "032.1";
export const demoSeedVersionKey = "bunya-demo-seed-version";
export const demoPassword = "Bunya@123";
export const demoPasswordProof = "f0832245d7b76d85a0eaa33188ea74e6417d2e6eb0ee18fb4dc18b282ac4960d";

export const demoAccountCredentials = [
  {id:"customer-adel",role:"customer",label:"حساب العميل",displayName:"عميل بُنية التجريبي",email:"customer.demo@bunya.test",username:"customer.demo",mobile:"0500000101",password:demoPassword,route:"/customer",status:"active"},
  {id:"provider-modern-materials",role:"provider",label:"حساب المزود",displayName:"شركة بُنية لمواد البناء",email:"provider.demo@bunya.test",username:"provider.demo",mobile:"0500000102",password:demoPassword,route:"/merchant",status:"approved"},
  {id:"ctr-asas",role:"contractor",label:"حساب المقاول",displayName:"مؤسسة بُنية للمقاولات",email:"contractor.demo@bunya.test",username:"contractor.demo",mobile:"0500000103",password:demoPassword,route:"/contractor",status:"approved"},
] as const;

export type DemoAccountCredential = (typeof demoAccountCredentials)[number];
export type DemoAccountRole = DemoAccountCredential["role"];


export type DriverAccountStatus = "active" | "suspended" | "must_change_password";
export type DriverDeliveryStatus = "assigned" | "picked_up" | "in_transit" | "arrived" | "delivered" | "failed_delivery";
export type DeliveryConfirmationMethod = "driver" | "provider";

export type ProviderDriver = {
  id:string;
  providerId:string;
  providerName:string;
  fullName:string;
  mobile:string;
  email:string;
  username:string;
  status:DriverAccountStatus;
  mustChangePassword:boolean;
  internalNotes?:string;
  failedCodeAttempts:number;
  violations:number;
  createdAt:string;
  updatedAt:string;
  lastActiveAt?:string;
};

export type DriverSession = {
  id:string;
  driverId:string;
  providerId:string;
  createdAt:string;
  lastActiveAt:string;
  revokedAt?:string;
};

export type DriverDeliveryUpdate = {
  id:string;
  status:DriverDeliveryStatus;
  note?:string;
  actorRole:"driver"|"provider"|"admin";
  actorId:string;
  createdAt:string;
};

export type DriverDeliveryAssignment = {
  id:string;
  providerId:string;
  driverId?:string;
  sourceDeliveryId:string;
  orderId:string;
  orderCode:string;
  deliveryCode:string;
  region:string;
  mapsUrl:string;
  pickupAt:string;
  expectedAt:string;
  status:DriverDeliveryStatus;
  deliveryCodeProof:string;
  codeAttempts:number;
  maxCodeAttempts:number;
  lockedUntil?:string;
  deliveryNote?:string;
  updates:DriverDeliveryUpdate[];
  createdAt:string;
  updatedAt:string;
  deliveredAt?:string;
};

export type DeliveryConfirmationRecord = {
  id:string;
  assignmentId:string;
  orderId:string;
  providerId:string;
  driverId?:string;
  method:DeliveryConfirmationMethod;
  confirmedById:string;
  delegateName?:string;
  deliveryReference?:string;
  note?:string;
  confirmedAt:string;
};

export type DriverAdminAction = {
  id:string;
  driverId:string;
  action:string;
  reason:string;
  adminId:string;
  createdAt:string;
};

export type PwaInstallState = {installed:boolean;dismissedAt?:string;installedAt?:string;platform?:string};
export type PwaRoleShortcut = {role:"customer"|"provider"|"contractor"|"driver"|"admin";name:string;url:string};

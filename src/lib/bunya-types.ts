export type UserRole = "customer" | "contractor" | "merchant" | "driver" | "admin";

export type ProductCategory = string;

export type ProductImage = {
  id: string;
  label: string;
  alt: string;
  tone: "cement" | "steel" | "blocks" | "insulation" | "plumbing" | "electric" | "wood" | "paint" | "tools";
};

export type ProductMeasurement = {
  id: string;
  label: string;
  unit: string;
  isDefault?: boolean;
};

export type DeliveryEstimate = {
  label: string;
  window: string;
  notes: string;
};

export type AvailableRegion = {
  city: string;
  scope: string;
};

export type Warranty = {
  label: string;
  duration: string;
  details: string;
};

export type Product = {
  id: string;
  name: string;
  category: ProductCategory;
  unit: string;
  description: string;
  shortDescription: string;
  fullDescription: string;
  availability: string;
  availabilityStatus: "متوفر" | "كمية محدودة" | "حسب الطلب";
  leadTime: string;
  specs: string[];
  measurements: ProductMeasurement[];
  units: string[];
  delivery: DeliveryEstimate;
  regions: AvailableRegion[];
  warranty: Warranty;
  images: ProductImage[];
  deliveryNotes: string;
  isNew?: boolean;
};

export type QuoteRequestItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  measurementId: string;
  measurementLabel: string;
  desiredReceiptDate: string;
  mapsUrl: string;
  notes?: string;
  createdAt: string;
};

export type OrderStatus =
  | "draft"
  | "collecting_quotes"
  | "final_offer_ready"
  | "paid"
  | "preparing"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export type QuoteRequest = {
  id: string;
  requesterRole: "customer" | "contractor";
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  city: string;
  locationHint: string;
  coordinates: string;
  quoteWindow: string;
  quoteDeadline: string;
  paymentStatus: string;
  deliveryPromise: string;
  handshakeCode: string;
  status: OrderStatus;
  createdAt: string;
};

export type MerchantQuote = {
  id: string;
  requestId: string;
  merchantName: string;
  maskedMerchant: string;
  price: number;
  deliveryDuration: string;
  notes?: string;
  eligible: boolean;
  receivedAt: string;
  status: "draft" | "sent" | "qualified" | "selected" | "rejected";
  statusLabel: string;
};

export type FinalOffer = {
  id: string;
  requestId: string;
  platformName: string;
  totalPrice: number;
  deliveryDuration: string;
  paymentStatus: string;
  offerStatus: "ready" | "accepted" | "paid";
};

export type OrderTimelineEvent = {
  title: string;
  description: string;
  time: string;
  status: OrderStatus;
};

export type ContractorProfile = {
  id: string;
  displayName: string;
  commercialName: string;
  city: string;
  badge: string;
  serviceTypes: string[];
  yearsExperience: number;
  summary: string;
  mockWorkImages: string[];
  phone: string;
  email: string;
  subscriptionActive: boolean;
  approvalStatus: "approved" | "pending";
};

export type SubscriptionPlan = {
  id: string;
  role: "provider" | "contractor";
  name: string;
  priceMonthly: number;
  description: string;
  benefits: string[];
  cta: string;
};

export type DriverDelivery = {
  id: string;
  orderId: string;
  productName: string;
  allowedDetails: string[];
  destination: string;
  mapLabel: string;
  eta: string;
  handshakeCode: string;
  status: "assigned" | "arrived" | "delivered";
  statusLabel: string;
};

export type AdminMetric = {
  label: string;
  value: string;
  detail: string;
};

export type ApplicationStatus = "pending" | "approved" | "rejected" | "needs_changes";

export type CustomerRegistration = {
  id: string;
  fullName: string;
  mobile: string;
  email: string;
  username: string;
  createdAt: string;
};

export type ParsedMapLocation = {
  url: string;
  kind: "coordinates" | "short-link" | "maps-link" | "invalid";
  latitude?: number;
  longitude?: number;
  message: string;
};

export type UploadedDocumentMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
};

export type ProviderApplication = {
  id: string;
  companyName: string;
  contactName: string;
  mobile: string;
  email: string;
  username: string;
  mapsUrl: string;
  latitude?: number;
  longitude?: number;
  discountCode?: string;
  categories: string[];
  deliveryAvailable: boolean;
  deliveryRegions: string[];
  status: ApplicationStatus;
  createdAt: string;
};

export type ContractorApplication = {
  id: string;
  contractorName: string;
  mobile: string;
  email: string;
  workRegions: string[];
  specialties: string[];
  documents: UploadedDocumentMetadata[];
  status: ApplicationStatus;
  createdAt: string;
};

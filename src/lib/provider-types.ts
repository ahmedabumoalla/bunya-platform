export type ProviderProductStatus = "draft" | "pending_review" | "active" | "rejected" | "unavailable";
export type ProductOfferType = "sale" | "rental";
export type ProductReviewStatus = ProviderProductStatus;
export type QuoteRequestStatus = "new" | "viewed" | "quoted" | "expired" | "unavailable";
export type ProviderQuoteStatus = "pending_customer" | "approved" | "rejected" | "expired" | "modified";
export type ProviderOrderStatus = "confirmed" | "preparing" | "ready_for_pickup" | "assigned_driver" | "out_for_delivery" | "delivered" | "completed" | "cancelled";
export type OrderStatus = ProviderOrderStatus;
export type SettlementStatus = "pending_review" | "approved" | "transferring" | "transferred" | "rejected";
export type NotificationType = "quote_request" | "quote_decision" | "product" | "order" | "delivery" | "settlement" | "admin";

export type ProviderProfile = {
  id: string;
  companyName: string;
  contactName: string;
  mobile: string;
  email: string;
  username: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
  categories: string[];
  deliveryAvailable: boolean;
  deliveryRegions: string[];
  logoLabel: string;
  accountStatus: "pending_review" | "approved" | "suspended";
  bankAccounts: ProviderBankAccount[];
};

export type ProviderBankAccount = {
  id: string;
  bankName: string;
  accountName: string;
  ibanMasked: string;
  isDefault: boolean;
};

export type ProductImageMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
  isPrimary: boolean;
  sortOrder: number;
};

export type ProductUnit = {
  id: string;
  name: string;
  isBase: boolean;
};

export type ProductMeasurement = {
  id: string;
  length?: number;
  width?: number;
  thickness?: number;
  unit: string;
  customUnit?: string;
  description?: string;
};

export type RentalDuration = {
  value: number;
  unit: "day" | "week" | "month" | "year" | "other";
  customUnit?: string;
};

export type ProductWarranty = {
  available: boolean;
  duration?: number;
  unit?: "day" | "month" | "year";
  details?: string;
  noWarrantyAccepted?: boolean;
};

export type ProductDeliveryConfig = {
  available: boolean;
  maximumDuration?: number;
  durationUnit?: "hour" | "day" | "week" | "other";
  customDurationUnit?: string;
  pricePerKilometer?: number;
  regions: string[];
  maximumDistanceKm?: number;
  notes?: string;
};

export type ProviderProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  availability: "available" | "limited" | "unavailable";
  minimumOrder?: number;
  stockQuantity?: number;
  images: ProductImageMetadata[];
  units: ProductUnit[];
  measurements: ProductMeasurement[];
  offerType: ProductOfferType;
  rentalDuration?: RentalDuration;
  price: number;
  currency: "SAR";
  vatInclusive: boolean;
  warranty: ProductWarranty;
  delivery: ProductDeliveryConfig;
  status: ProductReviewStatus;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type QuoteRequest = {
  id: string;
  requestCode: string;
  productId: string;
  productName: string;
  productImageLabel: string;
  category: string;
  quantity: number;
  unit: string;
  measurement: string;
  deliveryRegion: string;
  mapsUrl: string;
  desiredReceiptAt: string;
  receivedAt: string;
  deadlineAt: string;
  customerLabel: string;
  customerNotes?: string;
  specifications: string[];
  status: QuoteRequestStatus;
};

export type QuoteAttachmentMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
};

export type ProviderQuote = {
  id: string;
  quoteCode: string;
  requestId: string;
  requestCode: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  vatInclusive: boolean;
  vatAmount: number;
  deliveryFee: number;
  total: number;
  deliveryDuration: string;
  validUntil: string;
  providerNotes?: string;
  terms: string;
  attachments: QuoteAttachmentMetadata[];
  status: ProviderQuoteStatus;
  rejectionReason?: string;
  sentAt: string;
  updatedAt: string;
};

export type OrderStatusHistoryItem = {
  id: string;
  status: ProviderOrderStatus;
  label: string;
  at: string;
  note?: string;
};

export type ProviderOrder = {
  id: string;
  orderCode: string;
  quoteId: string;
  customerLabel: string;
  projectLabel: string;
  productName: string;
  productImageLabel: string;
  quantity: number;
  unit: string;
  total: number;
  paymentStatus: "pending" | "paid" | "refunded";
  status: ProviderOrderStatus;
  deliveryStatus: string;
  driverName?: string;
  deliveryRegion: string;
  mapsUrl: string;
  deliveryCodeVerified: boolean;
  createdAt: string;
  history: OrderStatusHistoryItem[];
};

export type DeliveryVerification = {
  proof: string;
  attempts: number;
  maxAttempts: number;
  verifiedAt?: string;
};

export type DeliveryAssignment = {
  id: string;
  deliveryCode: string;
  orderId: string;
  orderCode: string;
  driverName: string;
  driverPhone: string;
  status: "assigned" | "picked_up" | "out_for_delivery" | "delivered";
  assignedAt: string;
  deliveredAt?: string;
  customerConfirmed: boolean;
  verification: DeliveryVerification;
};

export type FinancialTransaction = {
  id: string;
  transactionCode: string;
  date: string;
  type: "order_amount" | "commission" | "tax" | "discount" | "settlement" | "refund";
  reference: string;
  amount: number;
  status: "pending" | "available" | "completed";
  balanceAfter: number;
};

export type SettlementRequest = {
  id: string;
  settlementCode: string;
  amount: number;
  bankAccountId: string;
  bankLabel: string;
  notes?: string;
  status: SettlementStatus;
  adminNotes?: string;
  createdAt: string;
};

export type ProviderNotification = {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  read: boolean;
  createdAt: string;
};

export type SupportTicket = {
  id: string;
  ticketCode: string;
  subject: string;
  category: string;
  priority: "low" | "normal" | "high";
  message: string;
  attachments: QuoteAttachmentMetadata[];
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
};

export type PlatformPolicy = {
  id: "product" | "warranty" | "delivery" | "settlement";
  title: string;
  summary: string;
  content: string[];
  updatedAt: string;
};

// Phase 10: Onboarding Wizard types

export interface OnboardingProfileRequest {
  name: string;
  businessName?: string;
  phone?: string;
  ico?: string;
  locale: string;
}

export interface BuiltinSelection {
  deviceTypeKey: string;
  defaultRevisionDurationMinutes?: number;
  defaultRevisionIntervalMonths?: number;
}

export interface CustomTypeCreation {
  label: string;
  defaultRevisionDurationMinutes: number;
  defaultRevisionIntervalMonths: number;
}

export interface OnboardingDevicesRequest {
  selectedBuiltins: BuiltinSelection[];
  customTypes: CustomTypeCreation[];
}

export interface OnboardingCompleteRequest {
  depot: {
    name: string;
    street: string;
    city: string;
    postalCode: string;
    lat: number;
    lng: number;
  };
}

export interface WaitlistJoinRequest {
  email: string;
  country: string;
  locale: string;
}

export interface WaitlistJoinResponse {
  ok: true;
  message: string;
}

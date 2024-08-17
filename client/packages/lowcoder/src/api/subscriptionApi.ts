import Api from "api/api";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { useSelector } from "react-redux";
import { getUser, getCurrentUser } from "redux/selectors/usersSelectors";
import { useEffect, useState } from "react";
import { calculateFlowCode }  from "./apiUtils";

// Interfaces
export interface CustomerAddress {
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

export interface LowcoderCustomer {
  hostname: string;
  email: string;
  orgId: string;
  userId: string;
  userName: string;
  type: string;
  companyName: string;
  address?: CustomerAddress;
}

interface LowcoderMetadata {
  lowcoder_host: string;
  lowcoder_orgId: string;
  lowcoder_type: string;
  lowcoder_userId: string;
}

export interface StripeCustomer {
  id: string;
  object: string;
  address?: object | null;
  balance: number;
  created: number;
  currency: string | null;
  default_source: string | null;
  delinquent: boolean;
  description: string | null;
  discount: string | null;
  email: string;
  invoice_prefix: string;
  invoice_settings: object | null;
  livemode: boolean;
  metadata: LowcoderMetadata;
  name: string;
  phone: string | null;
  preferred_locales: string[];
  shipping: string | null;
  tax_exempt: string;
  test_clock: string | null;
}

export interface Pricing {
  type: string;
  amount: string;
}

export interface Product {
  title: string;
  description: string;
  image: string;
  pricingType: string;
  pricing: Pricing[];
  activeSubscription: boolean;
  accessLink: string;
  subscriptionId: string;
  checkoutLink: string;
  checkoutLinkDataLoaded?: boolean;
  type?: string;
  quantity_entity?: string;
}

export interface SubscriptionItem {
  id: string;
  object: string;
  plan: {
    id: string;
    product: string;
  };
  quantity: number;
}

export type ResponseType = {
  response: any;
};

// Axios Configuration
const lcHeaders = {
  "Lowcoder-Token": calculateFlowCode(),
  "Content-Type": "application/json"
};

let axiosIns: AxiosInstance | null = null;

const getAxiosInstance = (clientSecret?: string) => {
  if (axiosIns && !clientSecret) {
    return axiosIns;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiRequestConfig: AxiosRequestConfig = {
    baseURL: "http://localhost:8080/api/flow",
    headers,
  };

  axiosIns = axios.create(apiRequestConfig);
  return axiosIns;
};

class SubscriptionApi extends Api {
  static async secureRequest(body: any): Promise<any> {
    let response;
    try {
      response = await getAxiosInstance().request({
        method: "POST",
        withCredentials: true,
        data: body,
      });
    } catch (error) {
      console.error("Error at Secure Flow Request:", error);
    }
    return response;
  }
}

// API Functions

export const searchCustomer = async (subscriptionCustomer: LowcoderCustomer) => {
  const apiBody = {
    path: "webhook/secure/search-customer",
    data: subscriptionCustomer,
    method: "post",
    headers: lcHeaders
  };
  try {
    const result = await SubscriptionApi.secureRequest(apiBody);
    return result?.data?.data?.length === 1 ? result.data.data[0] as StripeCustomer : null;
  } catch (error) {
    console.error("Error searching customer:", error);
    throw error;
  }
};

export const searchSubscriptions = async (customerId: string) => {
  const apiBody = {
    path: "webhook/secure/search-subscriptions",
    data: { customerId },
    method: "post",
    headers: lcHeaders
  };
  try {
    const result = await SubscriptionApi.secureRequest(apiBody);
    return result?.data?.data ?? [];
  } catch (error) {
    console.error("Error searching subscriptions:", error);
    throw error;
  }
};

export const createCustomer = async (subscriptionCustomer: LowcoderCustomer) => {
  const apiBody = {
    path: "webhook/secure/create-customer",
    data: subscriptionCustomer,
    method: "post",
    headers: lcHeaders
  };
  try {
    const result = await SubscriptionApi.secureRequest(apiBody);
    return result?.data as StripeCustomer;
  } catch (error) {
    console.error("Error creating customer:", error);
    throw error;
  }
};

export const createCheckoutLink = async (customer: StripeCustomer, priceId: string, quantity: number, discount?: number) => {
  const domain = window.location.protocol + "//" + window.location.hostname + (window.location.port ? ':' + window.location.port : '');
  
  const apiBody = {
    path: "webhook/secure/create-checkout-link",
    data: { 
      "customerId": customer.id, 
      "priceId": priceId, 
      "quantity": quantity, 
      "discount": discount, 
      baseUrl: domain 
    },
    method: "post",
    headers: lcHeaders
  };
  try {
    const result = await SubscriptionApi.secureRequest(apiBody);
    return result?.data ? { id: result.data.id, url: result.data.url } : null;
  } catch (error) {
    console.error("Error creating checkout link:", error);
    throw error;
  }
};

// Hooks

export const InitializeSubscription = () => {
  const [customer, setCustomer] = useState<StripeCustomer | null>(null);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState<boolean>(false);  // Track customer creation
  const [customerDataError, setCustomerDataError] = useState<boolean>(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [subscriptionDataLoaded, setSubscriptionDataLoaded] = useState<boolean>(false);
  const [subscriptionDataError, setSubscriptionDataError] = useState<boolean>(false);
  const [checkoutLinkDataLoaded, setCheckoutLinkDataLoaded] = useState<boolean>(false);
  const [checkoutLinkDataError, setCheckoutLinkDataError] = useState<boolean>(false);
  const [products, setProducts] = useState<Product[]>([
    {
      title: "Support Subscription",
      description: "Support Ticket System and SLAs to guarantee response time and your project success.",
      image: "https://gw.alipayobjects.com/zos/rmsportal/JiqGstEfoWAOHiTxclqi.png",
      pricingType: "Monthly, per User",
      pricing: [
        { type: "User", amount: "$3.49 (user, month)" },
        { type: "> 10 Users", amount: "$2.49 (user, month)" },
        { type: "> 100 Users", amount: "$1.49 (user, month)" }
      ],
      activeSubscription: false,
      accessLink: "1PhH38DDlQgecLSfSukEgIeV",
      subscriptionId: "",
      checkoutLink: "",
      checkoutLinkDataLoaded: false,
      type: "org",
      quantity_entity: "orgUser",
    },
    {
      title: "Premium Media Subscription",
      description: "Access to all features.",
      image: "https://gw.alipayobjects.com/zos/rmsportal/JiqGstEfoWAOHiTxclqi.png",
      pricingType: "Monthly, per User",
      pricing: [
        { type: "Volume Price", amount: "$20/month" },
        { type: "Single Price", amount: "$25/month" }
      ],
      activeSubscription: false,
      accessLink: "1Pf65wDDlQgecLSf6OFlbsD5",
      checkoutLink: "",
      checkoutLinkDataLoaded: false,
      subscriptionId: "",
      type: "user",
      quantity_entity: "singleItem",
    }
  ]);

  const user = useSelector(getUser);
  const currentUser = useSelector(getCurrentUser);
  const currentOrg = user.orgs.find(org => org.id === user.currentOrgId);
  const orgID = user.currentOrgId;
  const domain = window.location.protocol + "//" + window.location.hostname + (window.location.port ? ':' + window.location.port : '');
  const admin = user.orgRoleMap.get(orgID) === "admin" ? "admin" : "member";

  const subscriptionCustomer: LowcoderCustomer = {
    hostname: domain,
    email: currentUser.email,
    orgId: orgID,
    userId: user.id,
    userName: user.username,
    type: admin ? "admin" : "user",
    companyName: currentOrg?.name || "Unknown",
  };

  useEffect(() => {
    const initializeCustomer = async () => {
      try {
        setIsCreatingCustomer(true);
        const existingCustomer = await searchCustomer(subscriptionCustomer);
        if (existingCustomer) {
          setCustomer(existingCustomer);
        } else {
          const newCustomer = await createCustomer(subscriptionCustomer);
          setCustomer(newCustomer);
        }
      } catch (error) {
        setCustomerDataError(true);
      } finally {
        setIsCreatingCustomer(false);
      }
    };

    initializeCustomer();
  }, []);

  useEffect(() => {
    const fetchSubscriptions = async () => {
      if (customer) {
        try {
          const subs = await searchSubscriptions(customer.id);
          setSubscriptions(subs);
          setSubscriptionDataLoaded(true);
        } catch (error) {
          setSubscriptionDataError(true);
        }
      }
    };

    fetchSubscriptions();
  }, [customer]);

  useEffect(() => {
    const prepareCheckout = async () => {
      if (subscriptionDataLoaded) {
        try {
          const updatedProducts = await Promise.all(
            products.map(async (product) => {
              const matchingSubscription = subscriptions.find(
                (sub) => sub.plan.id === "price_" + product.accessLink
              );

              if (matchingSubscription) {
                return {
                  ...product,
                  activeSubscription: true,
                  checkoutLinkDataLoaded: true,
                  subscriptionId: matchingSubscription.id.substring(4),
                };
              } else {
                const checkoutLink = await createCheckoutLink(customer!, product.accessLink, 1);
                return {
                  ...product,
                  activeSubscription: false,
                  checkoutLink: checkoutLink ? checkoutLink.url : "",
                  checkoutLinkDataLoaded: true,
                };
              }
            })
          );

          setProducts(updatedProducts);
        } catch (error) {
          setCheckoutLinkDataError(true);
        }
      }
    };

    prepareCheckout();
  }, [subscriptionDataLoaded]);

  return {
    customer,
    isCreatingCustomer,
    customerDataError,
    subscriptions,
    subscriptionDataLoaded,
    subscriptionDataError,
    checkoutLinkDataLoaded,
    checkoutLinkDataError,
    products,
  };
};



export const CheckSubscriptions = () => {
  const [customer, setCustomer] = useState<StripeCustomer | null>(null);
  const [customerDataError, setCustomerDataError] = useState<boolean>(false);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [subscriptionDataLoaded, setSubscriptionDataLoaded] = useState<boolean>(false);
  const [subscriptionDataError, setSubscriptionDataError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  const user = useSelector(getUser);
  const currentUser = useSelector(getCurrentUser);
  const orgID = user.currentOrgId;
  const domain = window.location.protocol + "//" + window.location.hostname + (window.location.port ? ':' + window.location.port : '');

  const subscriptionCustomer: LowcoderCustomer = {
    hostname: domain,
    email: currentUser.email,
    orgId: orgID,
    userId: user.id,
    userName: user.username,
    type: user.orgRoleMap.get(orgID) === "admin" ? "admin" : "user",
    companyName: user.currentOrgId,
  };

  useEffect(() => {
    const fetchCustomerAndSubscriptions = async () => {
      try {
        const existingCustomer = await searchCustomer(subscriptionCustomer);
        if (existingCustomer) {
          setCustomer(existingCustomer);
          const subs = await searchSubscriptions(existingCustomer.id);
          setSubscriptions(subs);
          setSubscriptionDataLoaded(true);
        } else {
          setCustomer(null);
        }
      } catch (error) {
        setCustomerDataError(true);
        setSubscriptionDataError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchCustomerAndSubscriptions();
  }, []);

  return {
    customer,
    customerDataError,
    subscriptions,
    subscriptionDataLoaded,
    subscriptionDataError,
    loading,
  };
};

export default SubscriptionApi;

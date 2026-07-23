import NextAuth from 'next-auth';
import { JWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    controlPkey: number;
    companyCode: string;
    userGroup: number;
    empFkey: number | null;
    loginUserId: string;
    planId: number | null;
  }

  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      controlPkey: number;
      companyCode: string;
      userGroup: number; // 1 = admin, 2 = employee
      empFkey: number | null;
      loginUserId: string;
      planId: number | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    controlPkey: number;
    companyCode: string;
    userGroup: number;
    empFkey: number | null;
    loginUserId: string;
    planId: number | null;
  }
}

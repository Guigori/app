import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:{currentUser:null as unknown},signin:vi.fn(),signout:vi.fn(),exchange:vi.fn(),token:vi.fn(),create:vi.fn(),profile:vi.fn(),verify:vi.fn(),reload:vi.fn(),reset:vi.fn()}));
vi.mock('./firebase',()=>({firebaseAuth:mocks.auth,firebaseConfigurationError:null}));
vi.mock('./api',()=>({apiPostWithBearer:mocks.exchange,ApiError:class extends Error{}}));
vi.mock('firebase/auth',()=>({signInWithEmailAndPassword:mocks.signin,signOut:mocks.signout,createUserWithEmailAndPassword:mocks.create,updateProfile:mocks.profile,sendEmailVerification:mocks.verify,reload:mocks.reload,sendPasswordResetEmail:mocks.reset}));
import {openEmailSession,createEmailAccount,completeEmailVerification,resendAccountVerification,requestPasswordRecovery,emailSessionError} from './emailSession';
beforeEach(()=>{vi.clearAllMocks();mocks.auth.currentUser=null;mocks.signout.mockResolvedValue(undefined);mocks.token.mockResolvedValue('firebase-id-token');mocks.exchange.mockResolvedValue({id:'existing-uid'});mocks.signin.mockResolvedValue({user:{uid:'existing-uid',emailVerified:true,getIdToken:mocks.token}});mocks.create.mockResolvedValue({user:{uid:'new-uid'}});mocks.profile.mockResolvedValue(undefined);mocks.verify.mockResolvedValue(undefined);mocks.reset.mockResolvedValue(undefined);});
it('authenticates at Firebase and sends only the ID token to FastAPI, preserving UID',async()=>{
 expect(await openEmailSession(' teste.a@finnos.test ','vault-secret')).toEqual({id:'existing-uid'});
 expect(mocks.signin).toHaveBeenCalledWith(mocks.auth,'teste.a@finnos.test','vault-secret');
 expect(mocks.exchange).toHaveBeenCalledWith('/auth/firebase-session','firebase-id-token');expect(mocks.create).not.toHaveBeenCalled();
});
it('does not exchange a rejected password or disclose provider details',async()=>{
 const error={code:'auth/invalid-credential',message:'provider-private-detail'};mocks.signin.mockRejectedValueOnce(error);
 await expect(openEmailSession('a@finnos.test','bad')).rejects.toBe(error);expect(mocks.exchange).not.toHaveBeenCalled();expect(emailSessionError(error)).toBe('E-mail ou senha incorretos.');
});
it('does not open a server session for an unverified identity',async()=>{
 mocks.signin.mockResolvedValueOnce({user:{emailVerified:false}});await expect(openEmailSession('a@finnos.test','secret')).rejects.toThrow('Confirme seu e-mail');expect(mocks.exchange).not.toHaveBeenCalled();expect(mocks.signout).toHaveBeenCalled();
});
it('cleans up Firebase when the FastAPI exchange fails',async()=>{
 const error=new Error('server-session-failed');mocks.exchange.mockRejectedValueOnce(error);mocks.signout.mockRejectedValueOnce(new Error('cleanup-failed'));
 await expect(openEmailSession('a@finnos.test','secret')).rejects.toBe(error);
});
it('creates the Firebase identity once, even if verification delivery fails',async()=>{
 mocks.verify.mockRejectedValueOnce(new Error('delivery-failed'));expect(await createEmailAccount(' New User ',' new@example.test ','new-secret')).toEqual({uid:'new-uid',verificationSent:false});
 expect(mocks.create).toHaveBeenCalledOnce();expect(mocks.profile).toHaveBeenCalledWith({uid:'new-uid'},{displayName:'New User'});
});
it('reloads verified state and forces a fresh token after confirmation',async()=>{
 const user={uid:'pending',emailVerified:true,getIdToken:mocks.token};mocks.auth.currentUser=user;
 await completeEmailVerification('pending');expect(mocks.reload).toHaveBeenCalledWith(user);expect(mocks.token).toHaveBeenCalledWith(true);
});
it('refuses to confirm or resend for a different UID',async()=>{
 mocks.auth.currentUser={uid:'other'};await expect(completeEmailVerification('pending')).rejects.toThrow('Entre novamente');await expect(resendAccountVerification('pending')).rejects.toThrow('Entre novamente');expect(mocks.verify).not.toHaveBeenCalled();
});
it('keeps recovery independent of password changes and avoids account enumeration',async()=>{
 mocks.reset.mockRejectedValueOnce({code:'auth/user-not-found'});await requestPasswordRecovery(' missing@example.test ');
 expect(mocks.reset).toHaveBeenCalledWith(mocks.auth,'missing@example.test');expect(mocks.signin).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
});

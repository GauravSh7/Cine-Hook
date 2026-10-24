import express from 'express';
import request from 'supertest';
import {expect,it} from 'vitest';
import {ownershipRoutes} from '../src/modules/auth/ownership.routes.js';
import type {OwnershipService} from '../src/modules/auth/ownership.service.js';
import {errorHandler} from '../src/middleware/error-handler.js';

it.each(['/ownership/request','/ownership/complete'])('rejects retired verification at %s before any proof or account operation',async path=>{
  let accessed=false;
  const service={request:async()=>{accessed=true;return{}},complete:async()=>{accessed=true;return{}}} as unknown as OwnershipService;
  const app=express();app.use(express.json());app.use(ownershipRoutes(service,'http://localhost:5173'));app.use(errorHandler);
  const response=await request(app).post(path).send(path.endsWith('/request')?{purpose:'VERIFY_LEGACY',email:'owner@example.com'}:{purpose:'VERIFY_LEGACY',token:'t'.repeat(43),password:'new-password-123'});
  expect(response.status).toBe(400);expect(response.body.error.code).toBe('VALIDATION_ERROR');expect(accessed).toBe(false);
});

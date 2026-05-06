import dotenv from 'dotenv';
dotenv.config();

import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;
const expiration = '2h';

export function authMiddleware ({req}) {
  // authMiddleware takes request object from web server (including body, params, and headers)
    // allows token to be sent via req.body, req.query, or headers (as authorization)
    // we define our authorization header in our App.js on client side
    let token = req.body.token || req.query.token || req.headers.authorization; 

    // We split the token string into an array and return actual token
    if (req.headers.authorization) {
      token = token.split(' ').pop().trim();
    }

    // if we don't have a token, reqturn the request
    if (!token) {
      return req;
    }
    // if token can be verified, add the decoded user's data to the request so it can be accessed in the resolver
    try {
      const { data } = jwt.verify(token, secret, { maxAge: expiration });
      req.user = data;
    } catch {
      console.log('Invalid token');
    }

    // return the request object so it can be passed to the resolver as `context`
    return req; // req will have a req.user with data embedded within token
  };
  
export function signToken({ email, name, _id }) {
    const payload = { email, name, _id };
    return jwt.sign({ data: payload }, secret, { expiresIn: expiration });
  };
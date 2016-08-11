CakeRouter - _Because cakes have layers too_
============================================

Toy anonymous browsing network modeled after the Tor system.

## About

This was originally a class project for CSE461: Introduction to Computer Communication Networks at the Universty of Washington in Seattle. After the quarter ended, I continued to work on and improve it for about another 6 weeks until other classwork required me to put it down.

The intent of the project was to investigate the Tor routing system, as well as proxy and protocol design and implementation.

## CakeRouter Features

Major changes from the original project are as follows:

+ There is a _single_ layer of encryption over circuit traffic under that provided by TLS. This layer utilizes a shared symmetric key with 256-bit AES in Galois/Counter mode.
+ A circuit can be of any length, even one randomly generated at node start up.
+ The original project required contacting a hosted Registration Server. One that operates on the localhost has been included.
+ The addition of a Certification Server which serves the TLS Root CA for the Cake network and signs new nodes' CSRs. The Cerification Server has been merged with the Registration Server and only after receiving a certificate signed by the Root CA holder's private key can nodes register.
+ Nodes are assigned a unique AgentID from the Cerifitcation Server and cannot register without one (as opposed to nodes choosing their own Group/Instance numbers and hoping for non-collisions).

## TODO

+ Change all callbacks to be error-first
+ Design and implement a mechanism for key exchange between unique pairs of nodes
+ Bugs:
    - Annoying TLSSocket timeout at random times (might just need to alter a config/options setting)
    - Every once in a while, the proxy fails to load cnn.com and simply hangs

## Original Course Project Description

The original specification for the Tor61 network and nodes can be found at https://courses.cs.washington.edu/courses/cse461/16wi/projects/projTor61/projTor61.html

Major differences between the project and the Tor network:

+ Unlike the normal Tor network, Tor61 (and Cake) nodes are not divided into Entry, Gaurd, and Exit nodes. Rather, each node can play all three roles.
+ No TLS support.

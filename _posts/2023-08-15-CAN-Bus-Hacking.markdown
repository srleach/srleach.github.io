---
layout: post
title:  "CAN Bus Hacking"
date:   2023-08-15 22:54:12 +0000
categories: automotive can bmw F30
---
# CAN Bus Hacking
Forgive the overzealous use of the word "hacking" - it's hardly that.

I use a drop-in replacement head unit display for our 2013 (F30) 318d Touring. 

The unit gives Android Auto, CarPlay and a few other features that make the drive that little more enjoyable.

## The Problem
The head unit, whilst feature packed, lacks in a few areas and though it does what it says on the tin, 
lacks a few of the sensible features you'd like to see in a well-thought-out design. The biggest of these is that the 
steering wheel controls do not work to control media when using CarPlay or Android Auto.

Steering wheel control parsing is a solved problem. There are units available that will connect to the Car's bus, and 
emit the right signals for numerous third party units to achieve this. But what if we want to be a bit more abstract? 

Many users won't use a third party head unit at all, and would prefer to connect through a standard "AUX" (3.5mm) cable,
Bluetooth Audio Profile (A2DP or similar) or via a not-quite-well-implemented custom head unit. So how do we solve the 
issue for these different use cases?

## The Solution
Whilst chewing over the options to solve this, I decided that I'd create a tool called the CANOpener. Most modern cars 
lean on the CAN bus to share information between ECU's, and while there are some exceptions to this, cars of the era 
where this problem is resident almost universally share this technology - though each in a slightly different way.

### Hardware
The aim here is to use a fairly ubiquitous board, an ESP32 to listen to the Car's CAN bus at the head unit, and watch 
for messages of interest, before taking an action in relation to this message.

Whilst we started out trying to use this to handle SWC (Steering Wheel Control) messages, the thoughts are creeping in 
that we could also use this to handle other events present on the bus, and use these for our own reasons.

#### Preventing onward traffic
It became apparent during analysis that there are some messages which result in an action on the factory head unit, 
which we'd like to prevent occurring if we were to handle the message. This led to the thinking we'd have to effectively
man-in-the-middle the traffic to the head unit. Whilst not strictly necessary, this would mean we'd be able to (potentially)
do a lot more with the unit in the future.

#### (C)Analysis...
I'll follow on with more detailed information on this in future - the basics are that I used an MCP2515 transceiver 
paired with an ESP32 to capture traffic on the bus. I also used a USB-CAN Analyser from Amazon, and later a Raspberry Pi
hat with the relevant hardware to try and optimise the packet throughput that was achievable on the hardware. 

The MCP2515 Allows us to set filters and masks on the input data, meaning we can effectively observe only the traffic 
of interest, but this doesn't allow us to selectively pass on the traffic that isn't of interest. That's a problem to 
solve later down the road, though. 

I'll create another post in future including a little more detail on how this data was analysed along with code that's 
relevant.
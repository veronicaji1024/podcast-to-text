#!/bin/bash

# Podcast AI - Production Start Script
# This script starts the Podcast AI server in production mode

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                    Podcast AI Launcher                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${YELLOW}Warning: Node.js version is ${NODE_VERSION}. Recommended: 18+${NC}"
fi

echo -e "${GREEN}✓ Node.js version:$(node -v)${NC}"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Error: Python 3 is not installed${NC}"
    echo "Please install Python 3.8+ from https://python.org/"
    exit 1
fi

echo -e "${GREEN}✓ Python version:$(python3 --version)${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found${NC}"
    echo "Creating from .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo -e "${YELLOW}Please edit .env file and add your OpenAI API key${NC}"
    else
        echo -e "${RED}Error: .env.example not found${NC}"
        exit 1
    fi
fi

# Install Node.js dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing Node.js dependencies...${NC}"
    npm install
fi

# Check for faster-whisper
echo -e "${BLUE}Checking Python dependencies...${NC}"
if ! python3 -c "import faster_whisper" 2>/dev/null; then
    echo -e "${YELLOW}Warning: faster-whisper not installed${NC}"
    echo "Installing faster-whisper..."
    pip3 install faster-whisper
fi

echo -e "${GREEN}✓ faster-whisper installed${NC}"

# Create temp directory if not exists
mkdir -p server/temp

# Set environment
export NODE_ENV=production

# Start server
echo ""
echo -e "${GREEN}Starting Podcast AI Server...${NC}"
echo ""

node server/index.js

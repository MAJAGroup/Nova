# Nova - Explore your universe of information

## 1. Overview

Nova is an AI-powered browser workspace designed to make web browsing more organized, intuitive, and interactive. Instead of treating open tabs as a long, disconnected list, Nova transforms them into a visual constellation of information, helping users organize, explore, and navigate their browsing activity more naturally.

At its core, Nova combines AI-powered tab organization, customizable workspaces, and voice interaction within a unified cosmic-inspired interface. Its AI assistant, powered by the Gemini API, can analyze the content of open tabs and organize them into meaningful groups, which we call *constellations*. Beyond organization, the assistant can also help users understand and retrieve information from their browsing sessions by answering questions about open pages and providing concise summaries of relevant content. Users can also define their own categories and organize tabs according to their specific needs.

Nova further integrates ElevenLabs to bring voice interaction into the browsing experience, allowing users to interact with their browser and AI assistant through a more natural and accessible interface.

Our vision is to turn the browser from a place where users simply open websites into an intelligent workspace that helps them organize, explore, and understand information.

## 2. Motivation

Modern web browsing often involves opening many tabs while researching a topic, working on a project, comparing information, or switching between different tasks. Over time, these tabs become difficult to manage. Important pages get lost among unrelated ones, and users spend unnecessary time searching, switching, and reorganizing their browsing sessions.

Traditional browsers provide basic tab management features, but they generally rely on users to organize tabs manually. They offer limited assistance in understanding what each page is about or identifying relationships between different pages.

At the same time, AI assistants are becoming increasingly capable of understanding information and responding to natural-language requests. However, they are often separate from the browser environment, requiring users to switch between applications or manually provide context.

We wanted to bring these capabilities together in one environment.

Nova addresses three key challenges:

- **Information overload:** Helping users make sense of large numbers of open tabs.
- **Fragmented workflows:** Bringing AI assistance and browser organization into the browsing environment.
- **Interaction limitations:** Making browser interaction more natural through voice and an intuitive visual interface.

## 3. Key Features

### 3.1. AI-Powered Tab Grouping

Nova uses the Gemini API to analyze the content of open browser tabs and identify meaningful relationships between pages. Rather than relying only on tab titles or URLs, the AI assistant can use page content to understand the context of each tab and organize related information into groups.

These groups are represented visually as *constellations*, allowing users to see related pages together rather than navigating through a long horizontal tab bar.

### 3.2. Customizable Constellations

Users can also create their own categories and organize tabs according to their specific needs.

For example, someone conducting academic research might create constellations for literature review, datasets, methodology, and related tools. Someone planning a trip could organize pages into accommodation, transportation, and activities.

By combining AI-powered grouping with user-defined categories, Nova provides both intelligent automation and user control.

### 3.3. Context-Aware AI Assistant

Nova includes a Gemini-powered AI assistant that helps users make sense of the information they are exploring.

By using the content of open pages as context, users can ask questions about their current browsing session and receive relevant answers without manually switching between multiple tabs. For example, users can ask the assistant to summarize findings across relevant pages or locate specific information within their open tabs.

This helps users move beyond collecting information toward understanding and retrieving it more efficiently.

### 3.4. Voice Assistant Powered by ElevenLabs

Nova integrates ElevenLabs API to bring voice interaction into the browsing experience. The voice assistant provides a more natural way for users to communicate with the browser assistant, reducing reliance on traditional text-based interaction.

By combining voice capabilities with browser and AI functionality, Nova explores how users can interact with their browsing environment through conversational commands and responses.

### 3.5. Cosmic-Inspired Interface

Nova's interface takes inspiration from space exploration, with open tabs represented as elements in a visual environment and related pages organized into constellations.

The cosmic theme is not simply a visual style. It provides an alternative way to represent browsing activity, making relationships between pages and different browsing contexts easier to explore.

## 4. Technology Stack

Nova combines desktop application technologies, AI services, and voice capabilities.

| Technology | Purpose |
|---|---|
| Electron & Electron Builder | Cross-platform desktop application development and packaging |
| JavaScript, HTML, and CSS | Browser workspace and user interface |
| Three.js | 3D visualization of tabs and constellations |
| Google Gemini API | AI-powered assistance, page-content understanding, and intelligent tab grouping |
| ElevenLabs API | Natural voice interaction with the AI assistant |
| Browser APIs | Access to and management of open tabs and browser interactions |

## 5. Conclusion

Nova explores how AI, voice technology, and thoughtful interface design can come together to improve an everyday tool that people use constantly: the web browser.

By transforming open tabs into meaningful constellations, connecting AI assistance to browsing context, and introducing voice interaction, Nova aims to make browsing more organized, intuitive, and engaging.

Our vision is simple: **the browser should help users make sense of the information they explore, not just provide a place to open it.**

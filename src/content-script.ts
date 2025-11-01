import { playService } from '@/services/play.service';
import type { YouTubeVideoInfo } from '@/types/video.types';
import '@/styles/content-script.css';

// Add save button to YouTube video pages
export function addSaveButton() {
  if (!isYouTubeVideoPage()) return;

  console.log('SaveToPlay: Processing video page for save button');

  // Check if button already exists
  if (document.querySelector('.save-to-play-btn')) {
    console.log('SaveToPlay: Button already exists on video page');
    return;
  }

  const videoInfo = playService.extractYouTubeVideoInfo();
  if (!videoInfo) {
    console.log('SaveToPlay: Could not extract video info from video page');
    return;
  }

  console.log(
    'SaveToPlay: Extracted video info from video page:',
    videoInfo.id
  );

  // Find the title element
  const titleElement = findTitleElement();
  if (!titleElement) {
    console.log('SaveToPlay: Could not find title element on video page');
    return;
  }

  console.log('SaveToPlay: Found title element on video page');

  // Create save button
  const saveButton = createSaveButton(videoInfo);

  // Add the save button next to the title
  addButtonToTitle(titleElement, saveButton);

  // Check if video is already saved
  checkSavedStatus(videoInfo.url);
}

// Find the title element on YouTube pages
export function findTitleElement(): HTMLElement | null {
  // First try to find the element with id="title"
  const titleElement = document.querySelector('#title h1') as HTMLElement;

  if (titleElement && titleElement.textContent?.trim()) {
    return titleElement;
  }

  // Fallback selectors if #title h1 is not found
  const titleSelectors = [
    'h1.ytd-video-primary-info-renderer',
    'h1.ytd-watch-metadata',
    'h1.ytd-video-primary-info-renderer-title',
    'ytd-video-primary-info-renderer h1',
    'ytd-watch-metadata h1',
    '[id*="title"] h1:not(.ytdMiniplayerInfoBarTitle)',
    'h1:not(.ytdMiniplayerInfoBarTitle)',
    'ytd-video-primary-info-renderer yt-formatted-string.ytd-video-primary-info-renderer',
    'ytd-watch-metadata yt-formatted-string',
    'h1.ytd-video-primary-info-renderer-title yt-formatted-string',
    'ytd-video-primary-info-renderer-title h1',
    'ytd-video-primary-info-renderer-title yt-formatted-string',
  ];

  const fallbackTitleElement = titleSelectors
    .map((selector) => document.querySelector(selector) as HTMLElement)
    .filter((element) => element !== null)
    .find((element) => element.textContent?.trim());

  if (fallbackTitleElement) return fallbackTitleElement;

  return null;
}

// Add button next to title element
export function addButtonToTitle(
  titleElement: HTMLElement,
  button: HTMLElement
) {
  // Try to find the yt-formatted-string element within the title
  const titleTextElement = titleElement.querySelector('yt-formatted-string');

  if (titleTextElement && titleTextElement.parentElement) {
    // Add the button next to the yt-formatted-string element
    titleTextElement.parentElement.insertBefore(
      button,
      titleTextElement.nextSibling
    );

    // Also add some spacing
    const spacer = document.createElement('div');
    spacer.style.cssText = `
      display: inline-block !important;
      width: 12px !important;
      height: 1px !important;
    `;
    titleTextElement.parentElement.insertBefore(spacer, button);
  } else {
    // Fallback: place the button as a sibling next to the h1 element
    if (titleElement.parentElement) {
      titleElement.parentElement.insertBefore(button, titleElement.nextSibling);

      // Also add some spacing
      const spacer = document.createElement('div');
      spacer.style.cssText = `
        display: inline-block !important;
        width: 12px !important;
        height: 1px !important;
      `;
      titleElement.parentElement.insertBefore(spacer, button);
    } else {
      // Final fallback: add to the container that contains the h1
      const container = titleElement.closest(
        'ytd-video-primary-info-renderer, #primary-info, #info-contents'
      );
      if (container) {
        container.appendChild(button);
      }
    }
  }
}

export function createSaveButton(videoInfo: YouTubeVideoInfo): HTMLElement {
  const link = document.createElement('a');
  link.className = 'save-to-play-btn';
  link.setAttribute('data-video-id', videoInfo.id);
  link.href = '#';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  // Create the inner div with CSS classes
  const buttonDiv = document.createElement('div');
  buttonDiv.className = 'save-to-play-btn-inner';
  buttonDiv.title = 'Save video to Play';
  buttonDiv.textContent = `➕ Save to Play`;

  // Append the inner div to the container
  link.appendChild(buttonDiv);

  // Add click handler to save video
  link.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await handleSaveClick(videoInfo);
    } catch (error) {
      console.error('Failed to save video:', error);
    }
  });

  return link;
}

export async function handleSaveClick(videoInfo: YouTubeVideoInfo) {
  try {
    // Save video to Play and check for success response
    const success = await saveVideoToPlayWithResponse(videoInfo);

    if (success) {
      // Show success notification
      showNotification('Video saved to Play!', 'success');

      // Save to local database as new video
      await saveToLocalDatabase(videoInfo);

      // Note: Button state will only be updated when user clicks Sync
      // This ensures the sync is the source of truth for saved status
    } else {
      showNotification(
        'Failed to save video to Play. Make sure Play app is installed.',
        'error'
      );
    }
  } catch (error) {
    console.error('Error saving video:', error);
    showNotification(
      'Failed to save video to Play. Make sure Play app is installed.',
      'error'
    );
  }
}

// Save video to Play
export async function saveVideoToPlayWithResponse(
  videoInfo: YouTubeVideoInfo
): Promise<boolean> {
  try {
    const playUrl = `play://add?url=${encodeURIComponent(videoInfo.url)}`;

    // Use window.open instead of iframe to avoid "Launched external handler" issues
    window.open(playUrl, '_blank');

    // Assume success since we can't reliably detect if Play app handled it
    // The user will know if it worked by checking their Play app
    return true;
  } catch (error) {
    console.error('Error opening Play app:', error);
    return false;
  }
}

export async function saveToLocalDatabase(videoInfo: YouTubeVideoInfo) {
  try {
    const video = {
      id: videoInfo.id,
      title: videoInfo.title,
      description: videoInfo.description,
      url: videoInfo.url,
      date_published: videoInfo.publishedAt,
      second_url: videoInfo.url,
      channel: videoInfo.channelName
        ? {
          id: videoInfo.channelUrl?.split('/').pop() || '',
          name: videoInfo.channelName,
        }
        : undefined,
      duration_seconds: videoInfo.duration,
      source: 'YouTube',
      notes: videoInfo.notes || '',
      tags: videoInfo.tags || [],
      artwork_url_high_res: videoInfo.thumbnailUrl,
      is_new: 'Yes', // Newly saved videos are marked as new
      star_rating: '0',
      duration: videoInfo.duration,
      artwork_url: videoInfo.thumbnailUrl,
      date_watched: '',
      date_added: new Date().toISOString(),
      start_at_seconds: videoInfo.startAtSeconds?.toString() || '',
      saved_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };

    // Use message passing to save to background script's IndexedDB
    const response = await chrome.runtime.sendMessage({
      action: 'saveVideo',
      data: video,
    });

    if (response.success) {
      console.log('SaveToPlay: Video saved to database via background script');
    } else {
      console.error('SaveToPlay: Failed to save video:', response.error);
    }
  } catch (error) {
    console.error('Error saving to local database:', error);
  }
}

export async function checkSavedStatus(url: string) {
  try {
    console.log('SaveToPlay: Checking saved status for URL:', url);

    // Use message passing to get video info from background script
    const response = await chrome.runtime.sendMessage({
      action: 'getVideoByUrl',
      url: url,
    });

    if (response.success && response.video) {
      const video = response.video;
      console.log(
        'SaveToPlay: Found video in database:',
        video.id,
        'is_new:',
        video.is_new
      );
      // Find all buttons for this video (could be multiple on the page)
      const buttons = document.querySelectorAll(
        '.save-to-play-btn'
      ) as NodeListOf<HTMLElement>;
      console.log('SaveToPlay: Found', buttons.length, 'buttons on page');
      buttons.forEach((button) => {
        const buttonVideoId = button.getAttribute('data-video-id');
        console.log(
          'SaveToPlay: Button video ID:',
          buttonVideoId,
          'DB video ID:',
          video.id
        );
        if (buttonVideoId && video.id === buttonVideoId) {
          // Check if video is new or watched based on is_new property
          const isNew = video.is_new === 'Yes';
          console.log(
            'SaveToPlay: Updating button state for video:',
            video.id,
            'is_new:',
            isNew
          );
          updateButtonState(button, true, isNew, video.id);
        }
      });
    } else {
      console.log('SaveToPlay: Video not found in database for URL:', url);
    }
  } catch (error) {
    console.error('SaveToPlay: Error checking saved status:', error);
  }
}

export function updateButtonState(
  button: HTMLElement,
  isSaved: boolean,
  isNew: boolean = false,
  videoId?: string
) {
  const buttonDiv = button.querySelector('div') as HTMLElement;
  if (!buttonDiv) return;

  if (isSaved && videoId) {
    // Show "Saved To Play" or "Watched In Play" with link to Play app
    const text = isNew ? '✓ Saved To Play' : '✓ Watched In Play';
    buttonDiv.textContent = text;

    // Update CSS classes for state
    button.classList.remove('watched');
    if (isNew) {
      button.classList.add('saved');
    } else {
      button.classList.add('watched');
    }

    // Update the link href to open in Play app
    const link = button as HTMLAnchorElement;
    link.href = `play://open?id=${videoId}`;
    link.title = isNew ? 'Open in Play app' : 'Open in Play app';

    // Remove the custom click handler since it's now a proper link
    button.onclick = null;
  } else {
    buttonDiv.textContent = '➕ Save to Play';

    // Remove state classes
    button.classList.remove('saved', 'watched');

    // Reset the link href and add custom click handler for saving
    const link = button as HTMLAnchorElement;
    link.href = '#';
    link.title = 'Save video to Play';

    // Add click handler to save video
    const videoInfo = extractVideoInfoFromButton(button);
    if (videoInfo) {
      button.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await handleSaveClick(videoInfo);
        } catch (error) {
          console.error('Failed to save video:', error);
        }
      };
    }
  }
}

function showNotification(
  message: string,
  type: 'success' | 'warning' | 'error'
) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = `save-to-play-notification ${type}`;
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 12px 16px;
    border-radius: 8px;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    z-index: 10000;
    max-width: 300px;
    word-wrap: break-word;
    ${type === 'success' ? 'background-color: #4CAF50;' : ''}
    ${type === 'warning' ? 'background-color: #FF9800;' : ''}
    ${type === 'error' ? 'background-color: #F44336;' : ''}
  `;

  document.body.appendChild(notification);

  // Remove notification after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}

export function isYouTubeVideoPage(): boolean {
  return (
    window.location.hostname === 'www.youtube.com' &&
    window.location.pathname === '/watch'
  );
}

export function isYouTubeIndexPage(): boolean {
  return (
    window.location.hostname === 'www.youtube.com' &&
    (window.location.pathname === '/' ||
      window.location.pathname === '/feed/subscriptions' ||
      window.location.pathname === '/feed/trending' ||
      window.location.pathname.startsWith('/channel/') ||
      window.location.pathname.startsWith('/c/') ||
      window.location.pathname.startsWith('/user/') ||
      window.location.pathname.startsWith('/playlist?list=') ||
      (window.location.pathname.startsWith('/watch?v=') &&
        window.location.search.includes('list=')))
  );
}

export function isYouTubePlaylistPage(): boolean {
  return (
    (window.location.hostname === 'www.youtube.com' ||
      window.location.hostname === 'youtube.com') &&
    (window.location.pathname === '/playlist' ||
      window.location.pathname.startsWith('/playlist?') ||
      (window.location.pathname.startsWith('/watch') &&
        window.location.search.includes('list=')))
  );
}

/* v8 ignore start */

// Run on page load
console.log('SaveToPlay: Content script initialized on:', window.location.href);
console.log('SaveToPlay: Is video page:', isYouTubeVideoPage());
console.log('SaveToPlay: Is index page:', isYouTubeIndexPage());
console.log('SaveToPlay: Is playlist page:', isYouTubePlaylistPage());

// Initial execution with delay to allow YouTube to load content
setTimeout(async () => {
  addSaveButton();
  addSaveButtonsToVideoCards();

  // Add playlist functionality if on playlist page
  if (isYouTubePlaylistPage()) {
    addPlaylistSaveAllButton();
    updatePlaylistStats();
  }

  // Check saved status for all buttons after they're created
  await checkAllSavedStatus();
}, 2000); // Wait 2 seconds for YouTube to load

/* v8 ignore end */

// Extract video info from a button element
export function extractVideoInfoFromButton(
  button: HTMLElement
): YouTubeVideoInfo | null {
  const videoId = button.getAttribute('data-video-id');
  if (!videoId) return null;

  // Try to find the video card that contains this button
  const videoCard = button.closest(
    'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer'
  );
  if (videoCard) {
    return extractVideoInfoFromCard(videoCard);
  }

  // If we're on a video page, extract from the page
  if (isYouTubeVideoPage()) {
    return playService.extractYouTubeVideoInfo();
  }

  return null;
}

// Check saved status for all buttons on the page
async function checkAllSavedStatus() {
  try {
    console.log('SaveToPlay: Checking saved status for all buttons');
    const buttons = document.querySelectorAll(
      '.save-to-play-btn'
    ) as NodeListOf<HTMLElement>;
    console.log('SaveToPlay: Found', buttons.length, 'buttons to check');

    // Get all videos from background script
    const response = await chrome.runtime.sendMessage({
      action: 'getAllVideos',
    });

    if (response.success && response.videos) {
      const videos = response.videos;

      for (const button of Array.from(buttons)) {
        const videoId = button.getAttribute('data-video-id');
        if (videoId) {
          console.log('SaveToPlay: Checking button for video ID:', videoId);
          // Try to find the video in database
          const video = videos.find((v: any) => v.id === videoId);
          if (video) {
            console.log(
              'SaveToPlay: Found video in database:',
              video.id,
              'is_new:',
              video.is_new
            );
            const isNew = video.is_new === 'Yes';
            updateButtonState(button, true, isNew, video.id);
          } else {
            console.log(
              'SaveToPlay: Video not found in database for ID:',
              videoId
            );
          }
        }
      }
    } else {
      console.log('SaveToPlay: Failed to get videos from background script');
    }
  } catch (error) {
    console.error('SaveToPlay: Error checking all saved status:', error);
  }
}

// Add save buttons to video cards on index pages
function addSaveButtonsToVideoCards() {
  if (!isYouTubeIndexPage() && !isYouTubePlaylistPage()) return;

  console.log('SaveToPlay: Processing page for save buttons');

  // Find all video cards (using same selectors as YouTubeVideoOrganizer)
  const videoCards = document.querySelectorAll(
    'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer'
  );

  console.log('SaveToPlay: Found', videoCards.length, 'video cards');

  // Debug: Check what elements are actually on the page
  const allElements = document.querySelectorAll('*');
  const elementTypes = new Set<string>();
  allElements.forEach((el) => {
    if (el.tagName && el.tagName.includes('YTD')) {
      elementTypes.add(el.tagName.toLowerCase());
    }
  });
  console.log(
    'SaveToPlay: Found YTD elements on page:',
    Array.from(elementTypes)
  );

  videoCards.forEach((card, index) => {
    // Check if button already exists
    if (card.querySelector('.save-to-play-btn')) {
      console.log('SaveToPlay: Button already exists for card', index);
      return;
    }

    // Extract video info from the card
    const videoInfo = extractVideoInfoFromCard(card);
    if (!videoInfo) {
      console.log('SaveToPlay: Could not extract video info for card', index);
      return;
    }

    console.log(
      'SaveToPlay: Extracted video info for card',
      index,
      videoInfo.id
    );

    // Create save button
    const saveButton = createSaveButton(videoInfo);

    // Find the title element within the card
    const titleElement = card.querySelector(
      '#video-title, .ytd-video-renderer #video-title, .ytd-rich-item-renderer #video-title, h3 a'
    );

    if (titleElement && titleElement.parentElement) {
      console.log('SaveToPlay: Adding button next to title for card', index);
      // Add the button next to the title
      titleElement.parentElement.insertBefore(
        saveButton,
        titleElement.nextSibling
      );

      // Check if video is already saved
      checkSavedStatus(videoInfo.url);
    } else {
      console.log('SaveToPlay: Could not find title element for card', index);
    }
  });
}

export function extractVideoInfoFromCard(
  card: Element
): YouTubeVideoInfo | null {
  try {
    // Extract video ID from the card
    const linkElement = card.querySelector(
      'a[href*="/watch?v="]'
    ) as HTMLAnchorElement;
    if (!linkElement) return null;

    const url = linkElement.href;
    const videoId = url.match(/[?&]v=([^&]+)/)?.[1];
    if (!videoId) return null;

    // Extract title
    const titleElement = card.querySelector(
      '#video-title, .ytd-video-renderer #video-title, .ytd-rich-item-renderer #video-title'
    );
    const title = titleElement?.textContent?.trim() || 'Unknown Title';

    // Extract channel name
    const channelElement = card.querySelector(
      '#channel-name, .ytd-channel-name, .ytd-video-renderer #channel-name'
    );
    const channelName = channelElement?.textContent?.trim();

    // Extract channel URL
    const channelLink = card.querySelector(
      'a[href*="/channel/"], a[href*="/c/"], a[href*="/user/"]'
    ) as HTMLAnchorElement;
    const channelUrl = channelLink?.href;

    return {
      id: videoId,
      title,
      url,
      channelName,
      channelUrl,
      thumbnailUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    };
  } catch (error) {
    console.error('Error extracting video info from card:', error);
    return null;
  }
}

/* v8 ignore start */
// Run when URL changes (for SPA navigation)
let currentUrl = window.location.href;
const observer = new MutationObserver(() => {
  if (window.location.href !== currentUrl) {
    currentUrl = window.location.href;
    setTimeout(async () => {
      addSaveButton(); // For video pages
      addSaveButtonsToVideoCards(); // For index pages

      // Add playlist functionality if on playlist page
      if (isYouTubePlaylistPage()) {
        addPlaylistSaveAllButton();
        updatePlaylistStats();
      }

      // Check saved status for all buttons after navigation
      await checkAllSavedStatus();
    }, 1000); // Wait for page to load
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Initialize message listener immediately (for clipboard reading)
console.log('Content script loaded on:', window.location.href);

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender' });
    return;
  }

  switch (request.action) {
    case 'readClipboard':
      handleReadClipboard(sendResponse);
      return true; // Keep message channel open for async response
    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});

/* v8 ignore end */

async function handleReadClipboard(sendResponse: (response: any) => void) {
  try {
    console.log('Content script: Attempting to read clipboard...');

    // Check if clipboard API is available
    if (!navigator.clipboard) {
      sendResponse({
        success: false,
        error: 'Clipboard API not available in this context',
      });
      return;
    }

    const clipboardText = await navigator.clipboard.readText();

    console.log(
      'Content script: Successfully read clipboard, length:',
      clipboardText.length
    );

    sendResponse({
      success: true,
      text: clipboardText,
      debugInfo: {
        textLength: clipboardText.length,
        hasContent: clipboardText.length > 0,
      },
    });
  } catch (error) {
    console.error('Content script: Error reading clipboard:', error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    sendResponse({
      success: false,
      error: errorMessage,
      debugInfo: {
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: errorMessage,
      },
    });
  }
}

// Playlist functionality
function addPlaylistSaveAllButton() {
  console.log('SaveToPlay: addPlaylistSaveAllButton called');

  if (!isYouTubePlaylistPage()) {
    console.log('SaveToPlay: Not a playlist page, returning');
    return;
  }

  console.log('SaveToPlay: Adding playlist save all button');

  // Check if button already exists
  if (document.querySelector('.playlist-save-all-btn')) {
    console.log('SaveToPlay: Playlist save all button already exists');
    return;
  }

  // Find the playlist title element
  const titleElement = findPlaylistTitleElement();
  if (!titleElement) {
    console.log('SaveToPlay: Could not find playlist title element');
    return;
  }

  console.log('SaveToPlay: Found title element, creating button');

  // Create save all button
  const saveAllButton = createPlaylistSaveAllButton();

  // Add the button after the title
  addButtonAfterTitle(titleElement, saveAllButton);

  console.log('SaveToPlay: Button added successfully');
}

function findPlaylistTitleElement(): HTMLElement | null {
  console.log('SaveToPlay: Looking for playlist title element');

  // Look for the playlist title element
  const titleSelectors = [
    'ytd-playlist-header-renderer yt-formatted-string#text',
    'ytd-playlist-header-renderer yt-dynamic-sizing-formatted-string',
    'ytd-playlist-header-renderer h1',
    'ytd-playlist-header-renderer yt-formatted-string',
    'ytd-playlist-header-renderer .ytd-playlist-header-renderer',
  ];

  for (const selector of titleSelectors) {
    console.log('SaveToPlay: Trying selector:', selector);
    const element = document.querySelector(selector) as HTMLElement;
    if (element && element.textContent?.trim()) {
      console.log(
        'SaveToPlay: Found title element with text:',
        element.textContent.trim()
      );
      return element;
    }
  }

  console.log('SaveToPlay: No title element found');
  return null;
}

function addButtonAfterTitle(titleElement: HTMLElement, button: HTMLElement) {
  console.log('SaveToPlay: Adding button after title');

  // Find the metadata wrapper that contains the title and metadata
  const metadataWrapper =
    titleElement.closest('.metadata-wrapper') ||
    titleElement.closest('ytd-playlist-header-renderer') ||
    titleElement.parentElement;

  console.log(
    'SaveToPlay: Found metadata wrapper:',
    metadataWrapper?.tagName,
    metadataWrapper?.className
  );

  if (metadataWrapper) {
    // Find the metadata action bar to insert before it
    const actionBar = metadataWrapper.querySelector('.metadata-action-bar');
    const playMenu = metadataWrapper.querySelector('.play-menu');

    if (actionBar) {
      console.log('SaveToPlay: Found metadata action bar, inserting before it');
      metadataWrapper.insertBefore(button, actionBar);
    } else if (playMenu) {
      console.log('SaveToPlay: Found play menu, inserting before it');
      metadataWrapper.insertBefore(button, playMenu);
    } else {
      console.log(
        'SaveToPlay: No action bar/play menu found, inserting after title'
      );
      // Add the button after the title element
      metadataWrapper.insertBefore(button, titleElement.nextSibling);
    }

    console.log('SaveToPlay: Button inserted into metadata wrapper');

    // Verify the button is in the DOM
    const buttonInDOM = document.querySelector('.playlist-save-all-btn');
    if (buttonInDOM) {
      console.log('SaveToPlay: Button found in DOM after insertion');
      console.log(
        'SaveToPlay: Button computed styles:',
        window.getComputedStyle(buttonInDOM)
      );
      console.log(
        'SaveToPlay: Button parent:',
        buttonInDOM.parentElement?.tagName,
        buttonInDOM.parentElement?.className
      );

      // Force a reflow to ensure the button is visible
      (buttonInDOM as HTMLElement).offsetHeight;

      // Check if the button is actually visible
      const rect = buttonInDOM.getBoundingClientRect();
      console.log('SaveToPlay: Button bounding rect:', rect);
      console.log(
        'SaveToPlay: Button is visible:',
        rect.width > 0 && rect.height > 0
      );
    } else {
      console.log('SaveToPlay: Button NOT found in DOM after insertion');
    }
  } else {
    console.log('SaveToPlay: No metadata wrapper found for button placement');
  }
}

function createPlaylistSaveAllButton(): HTMLElement {
  console.log('SaveToPlay: Creating playlist save all button');

  // Get all video URLs from the playlist
  const videoCards = document.querySelectorAll(
    'ytd-playlist-video-renderer, ytd-video-renderer'
  );

  const videoUrls: string[] = [];
  const videoInfos: YouTubeVideoInfo[] = [];

  for (const card of Array.from(videoCards)) {
    const videoInfo = extractVideoInfoFromCard(card);
    if (videoInfo) {
      videoUrls.push(videoInfo.url);
      videoInfos.push(videoInfo);
    }
  }

  // Create the bulk URL with newlines (%0A in URL encoding)
  const allUrls = videoUrls.join('\n');
  const bulkPlayUrl = `play://add?url=${encodeURIComponent(allUrls)}`;

  console.log('SaveToPlay: Created bulk URL for', videoUrls.length, 'videos');
  console.log('SaveToPlay: Bulk URL:', bulkPlayUrl);

  // Create anchor element instead of button
  const link = document.createElement('a');
  link.className = 'playlist-save-all-btn';
  link.href = bulkPlayUrl;
  link.target = '_blank';
  link.innerHTML = `
    <div class="playlist-save-all-btn-inner">
      <span>💾 Save All To Play (${videoUrls.length} videos)</span>
    </div>
  `;

  // Add some inline styles to ensure visibility
  link.style.cssText = `
    display: block !important;
    margin: 12px 0 !important;
    width: auto !important;
    text-decoration: none !important;
    visibility: visible !important;
    opacity: 1 !important;
    z-index: 999999 !important;
    position: relative !important;
  `;

  console.log('SaveToPlay: Link created with HTML:', link.outerHTML);
  return link;
}

async function updatePlaylistStats() {
  if (!isYouTubePlaylistPage()) return;

  console.log('SaveToPlay: Updating playlist stats');

  // Remove existing stats if they exist
  const existingStats = document.querySelector('.playlist-stats');
  if (existingStats) {
    existingStats.remove();
  }

  // Get all video cards in the playlist
  const videoCards = document.querySelectorAll(
    'ytd-playlist-video-renderer, ytd-video-renderer'
  );

  const totalVideos = videoCards.length;
  let savedVideos = 0;

  // Count saved videos using background script
  const response = await chrome.runtime.sendMessage({
    action: 'getAllVideos',
  });

  if (response.success && response.videos) {
    const videos = response.videos;

    for (const card of Array.from(videoCards)) {
      const videoInfo = extractVideoInfoFromCard(card);
      if (videoInfo) {
        const video = videos.find((v: any) => v.id === videoInfo.id);
        if (video) {
          savedVideos++;
        }
      }
    }
  }

  // Create stats element
  const statsElement = document.createElement('div');
  statsElement.className = 'playlist-stats';
  statsElement.innerHTML = `
    <div class="playlist-stats-inner">
      <span>📊 ${savedVideos}/${totalVideos} videos in Play</span>
    </div>
  `;

  // Find the playlist title element and add stats below it
  const titleElement = findPlaylistTitleElement();
  if (titleElement) {
    const metadataWrapper =
      titleElement.closest('.metadata-wrapper') ||
      titleElement.closest('ytd-playlist-header-renderer') ||
      titleElement.parentElement;

    if (metadataWrapper) {
      // Find the save all button to place stats after it
      const saveAllButton = metadataWrapper.querySelector(
        '.playlist-save-all-btn'
      );
      if (saveAllButton) {
        metadataWrapper.insertBefore(statsElement, saveAllButton.nextSibling);
      } else {
        // Place stats after the title but before the action bar
        const actionBar = metadataWrapper.querySelector('.metadata-action-bar');
        if (actionBar) {
          metadataWrapper.insertBefore(statsElement, actionBar);
        } else {
          metadataWrapper.insertBefore(statsElement, titleElement.nextSibling);
        }
      }
    }
  }
}

import { dbService } from '@/services/db.service';

/* v8 ignore start */
// Initialize database when extension loads
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await dbService.init();
    console.log('SaveToPlay extension initialized');
  } catch (error) {
    console.error('Failed to initialize SaveToPlay extension:', error);
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    console.warn('Received message from unknown sender:', sender);
    return;
  }

  switch (request.action) {
    case 'saveVideo':
      handleSaveVideo(request.data, sendResponse);
      return true; // Keep message channel open for async response

    case 'syncVideos':
      handleSyncVideos(sendResponse);
      return true;

    case 'getVideoInfo':
      handleGetVideoInfo(request.url, sendResponse);
      return true;

    case 'getVideoByUrl':
      handleGetVideoByUrl(request.url, sendResponse);
      return true;

    case 'getAllVideos':
      handleGetAllVideos(sendResponse);
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }
});
/* v8 ignore end */

export async function handleSaveVideo(
  videoInfo: any,
  sendResponse: (response: any) => void
) {
  try {
    // Check if this is a direct save (from content script) or a Play app save
    if (videoInfo.url && videoInfo.id) {
      // This is a direct save from content script - just save to database
      await dbService.addVideo(videoInfo);
      sendResponse({ success: true, message: 'Video saved to database' });
    } else {
      // This is a Play app save - save to Play app and database
      const playUrl = `play://add?url=${encodeURIComponent(videoInfo.url)}`;

      // Open Play app
      await chrome.tabs.create({ url: playUrl, active: false });

      // Also save to local database for tracking
      const video = {
        ...videoInfo,
        savedAt: new Date().toISOString(),
        lastSyncedAt: new Date().toISOString(),
      };

      await dbService.addVideo(video);

      sendResponse({ success: true, message: 'Video saved to Play' });
    }
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleSyncVideos(sendResponse: (response: any) => void) {
  try {
    // Try multiple approaches to read clipboard
    let clipboardText = '';
    let dataSource = 'unknown';

    // Approach 1: Try content script on active tab
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      console.log('Found tabs:', tabs);

      if (tabs && tabs.length > 0) {
        const tab = tabs[0];

        if (tab && tab.id) {
          console.log('Trying content script on tab:', tab.id, 'URL:', tab.url);

          // Try to inject a simple clipboard reading function
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              func: async () => {
                try {
                  console.log(
                    'Injected script: Attempting to read clipboard...'
                  );

                  // Method 1: Try direct clipboard API first
                  try {
                    const clipboardText = await navigator.clipboard.readText();
                    console.log(
                      'Injected script: Successfully read clipboard via API, length:',
                      clipboardText.length
                    );
                    return { success: true, text: clipboardText };
                  } catch (apiError) {
                    console.log(
                      'Injected script: Clipboard API failed, trying paste method:',
                      apiError
                    );
                  }

                  // Method 2: Use paste event as fallback
                  return new Promise<{
                    success: boolean;
                    text?: string;
                    error?: string;
                  }>((resolve) => {
                    // Create a temporary input field
                    const tempInput = document.createElement('textarea');
                    tempInput.style.position = 'fixed';
                    tempInput.style.left = '-9999px';
                    tempInput.style.top = '-9999px';
                    tempInput.style.opacity = '0';
                    document.body.appendChild(tempInput);

                    // Focus the input
                    tempInput.focus();

                    // Set up paste event listener
                    const pasteHandler = (e: ClipboardEvent) => {
                      e.preventDefault();
                      const pastedText =
                        e.clipboardData?.getData('text/plain') || '';
                      console.log(
                        'Injected script: Successfully read clipboard via paste, length:',
                        pastedText.length
                      );

                      // Clean up
                      document.body.removeChild(tempInput);
                      document.removeEventListener('paste', pasteHandler);

                      resolve({ success: true, text: pastedText });
                    };

                    document.addEventListener('paste', pasteHandler);

                    // Trigger paste
                    setTimeout(() => {
                      document.execCommand('paste');

                      // Fallback: if paste doesn't work, try to get the value
                      setTimeout(() => {
                        const value = tempInput.value;
                        if (value) {
                          console.log(
                            'Injected script: Got clipboard via input value, length:',
                            value.length
                          );
                          document.body.removeChild(tempInput);
                          document.removeEventListener('paste', pasteHandler);
                          resolve({ success: true, text: value });
                        } else {
                          console.log('Injected script: Paste method failed');
                          document.body.removeChild(tempInput);
                          document.removeEventListener('paste', pasteHandler);
                          resolve({
                            success: false,
                            error: 'Could not read clipboard via any method',
                          });
                        }
                      }, 100);
                    }, 50);
                  });
                } catch (error) {
                  console.error(
                    'Injected script: Error reading clipboard:',
                    error
                  );
                  return {
                    success: false,
                    error:
                      error instanceof Error ? error.message : String(error),
                  };
                }
              },
            });

            console.log('Injected script results:', results);

            if (
              results &&
              results[0] &&
              results[0].result &&
              results[0].result.success
            ) {
              clipboardText = results[0].result.text || '';
              dataSource = 'injected_script';
              console.log(
                'Successfully read clipboard via injected script:',
                clipboardText
              );
            } else {
              console.log('Injected script failed:', results?.[0]?.result);
            }
          } catch (injectionError) {
            console.log('Script injection failed:', injectionError);

            // Fallback: try the original content script approach
            try {
              const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'readClipboard',
              });

              console.log('Content script response:', response);

              if (response && response.success) {
                clipboardText = response.text;
                dataSource = 'content_script';
                console.log(
                  'Successfully read clipboard via content script:',
                  clipboardText
                );
              }
            } catch (messageError) {
              console.log('Content script message failed:', messageError);
            }
          }
        }
      }
    } catch (contentScriptError) {
      console.log('Content script approach failed:', contentScriptError);
    }

    // Approach 2: Try background script clipboard (might work in some cases)
    if (!clipboardText) {
      try {
        console.log('Trying background script clipboard...');
        clipboardText = await navigator.clipboard.readText();
        dataSource = 'background_script';
        console.log(
          'Successfully read clipboard via background script:',
          clipboardText
        );
      } catch (backgroundClipboardError) {
        console.log(
          'Background script clipboard failed:',
          backgroundClipboardError
        );
      }
    }

    // If both approaches failed, return error
    if (!clipboardText) {
      sendResponse({
        success: false,
        error:
          'Could not read clipboard from any source. Please use manual paste.',
        needsManualPaste: true,
        debugInfo: {
          dataSource,
          message:
            'Both content script and background script clipboard reading failed',
        },
      });
      return;
    }

    if (!clipboardText) {
      sendResponse({
        success: false,
        error:
          'No data found in clipboard. Please ensure your shortcut copies JSON data.',
        needsManualPaste: true,
      });
      return;
    }

    // Parse JSON data
    let playVideos = [];
    try {
      const parsed = JSON.parse(clipboardText);
      if (Array.isArray(parsed)) {
        playVideos = parsed;
      } else if (parsed && typeof parsed === 'object') {
        playVideos = [parsed];
      }
    } catch (parseError) {
      sendResponse({
        success: false,
        error:
          'Invalid JSON data in clipboard. Please check your shortcut output.',
        needsManualPaste: true,
      });
      return;
    }

    if (playVideos.length === 0) {
      sendResponse({
        success: false,
        error: 'No video data found in clipboard.',
        needsManualPaste: true,
      });
      return;
    }

    // Process videos
    let videosAdded = 0;
    let videosUpdated = 0;

    for (const playVideo of playVideos) {
      try {
        // Convert Play video data to our internal format (1-to-1 mapping)
        const video = {
          id: playVideo.id,
          title: playVideo.title,
          description: playVideo.description,
          url: playVideo.url,
          date_published: playVideo.date_published,
          second_url: playVideo.second_url,
          channel: playVideo.channel,
          duration_seconds: playVideo.duration_seconds,
          source: playVideo.source,
          notes: playVideo.notes,
          tags: playVideo.tags,
          artwork_url_high_res: playVideo.artwork_url_high_res,
          is_new: playVideo.is_new,
          star_rating: playVideo.star_rating,
          duration: playVideo.duration,
          artwork_url: playVideo.artwork_url,
          date_watched: playVideo.date_watched,
          date_added: playVideo.date_added,
          start_at_seconds: playVideo.start_at_seconds,
          saved_at: playVideo.date_added,
          last_synced_at: new Date().toISOString(),
        };

        // Check if video already exists
        const existingVideo = await dbService.getVideo(playVideo.id);

        if (existingVideo) {
          await dbService.updateVideo(video);
          videosUpdated++;
        } else {
          await dbService.addVideo(video);
          videosAdded++;
        }
      } catch (error) {
        console.error(`Error processing video ${playVideo.id}:`, error);
      }
    }

    sendResponse({
      success: true,
      message: `Synced ${videosAdded} new videos and updated ${videosUpdated} existing videos.`,
      videosAdded,
      videosUpdated,
    });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      needsManualPaste: true,
    });
  }
}

export async function handleGetVideoInfo(
  url: string,
  sendResponse: (response: any) => void
) {
  try {
    const video = await dbService.getVideoByUrl(url);
    sendResponse({ success: true, video });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleGetVideoByUrl(
  url: string,
  sendResponse: (response: any) => void
) {
  try {
    const video = await dbService.getVideoByUrl(url);
    sendResponse({ success: true, video });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleGetAllVideos(
  sendResponse: (response: any) => void
) {
  try {
    const videos = await dbService.getAllVideos();
    sendResponse({ success: true, videos });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

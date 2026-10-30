
//stops user typed text from being read as html when it goes into innerHTML
function escapeHtml(value){
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

//cognito logout used for both normal users and staff
async function logoutBack2U(){
  const token =
    sessionStorage.getItem('back2u_access_token');

  try {
    if (token){
      await fetch(
        'https://cognito-idp.us-east-1.amazonaws.com/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-amz-json-1.1',
            'X-Amz-Target':
              'AWSCognitoIdentityProviderService.GlobalSignOut'
          },
          body: JSON.stringify({
            AccessToken: token
          })
        }
      );
    }

  } catch (error){
    console.error(
      'Cognito logout error:',
      error
    );

  } finally {
    //still clears the browser session even if aws logout fails
    sessionStorage.removeItem(
      'back2u_access_token'
    );

    sessionStorage.removeItem(
      'back2u_id_token'
    );

    sessionStorage.removeItem(
      'back2u_refresh_token'
    );

    sessionStorage.removeItem(
      'back2u_user_session'
    );

    sessionStorage.removeItem(
      'back2u_staff_session'
    );

    window.location.href =
      'login.html';
  }
}

window.logoutBack2U = logoutBack2U;

//changes the navbar based on who is signed in
document.addEventListener(
  'DOMContentLoaded',
  () => {
    const navActions =
      document.querySelector('.nav-actions');

    if (!navActions){
      return;
    }

    const userSignedIn =
      sessionStorage.getItem(
        'back2u_user_session'
      ) === 'active';

    const staffSignedIn =
      sessionStorage.getItem(
        'back2u_staff_session'
      ) === 'active';


    //staff portal gets a real logout button
    if (document.getElementById('reviewQueue')){
      navActions.innerHTML = `
        <button
          class="btn"
          onclick="logoutBack2U()"
        >
          Log Out
        </button>
      `;

      return;
    }


    //staff that leaves the portal can still return or log out
    if (staffSignedIn){
      navActions.innerHTML = `
        <a
          class="btn"
          href="staff_review.html"
        >
          Staff Portal
        </a>

        <button
          class="btn"
          onclick="logoutBack2U()"
        >
          Log Out
        </button>
      `;

      return;
    }


    if (userSignedIn){
      navActions.innerHTML = `
        <button
          class="btn btn-dark"
          onclick="logoutBack2U()"
        >
          Log Out
        </button>
      `;
    }
  }
);

if (document.getElementById('scrollRow')) {
(function(){
    function scrollRow(dir){
      const row = document.getElementById('scrollRow');
      row.scrollBy({ left: dir * 340, behavior: 'smooth' });
    }

    //scatter animation
    (function(){
      function easeOutQuad(t){ return t * (2 - t); }

      function setTransform(el, transform){
        el.style.transform = transform;
        el.style.WebkitTransform = transform;
      }

      const items = Array.from(document.querySelectorAll('#clusterStage .item'));
      const hero = document.querySelector('.hero');

      let current = 0;
      let target = 0;
      const ease = 0.12;
      let rafId, rafActive = false;

      const offsetMaxList = items.map(el => ({
        x: parseFloat(el.dataset.vx) * 260,
        y: parseFloat(el.dataset.vy) * 260
      }));
      const rotateMaxList = items.map(el => parseFloat(el.dataset.rot));

      function updateAnimationItems(){
        const heroHeight = hero.offsetHeight;
        const ratio = Math.min(Math.max(current / (heroHeight * 0.75), 0), 1);
        const eased = easeOutQuad(ratio);

        items.forEach((el, index) => {
          const offsetMax = offsetMaxList[index];
          const rotateMax = rotateMaxList[index];

          const x = (offsetMax.x * eased).toFixed(2);
          const y = (offsetMax.y * eased).toFixed(2);
          const rotate = (rotateMax + rotateMax * ratio * 2).toFixed(2);
          const opacity = Math.max(1 - ratio * 1.1, 0);

          setTransform(el, `translate(${x}px, ${y}px) rotate(${rotate}deg)`);
          el.style.opacity = opacity;
        });
      }

      function updateAnimation(){
        const diff = target - current;
        const delta = Math.abs(diff) < 0.1 ? 0 : diff * ease;

        if (delta){
          current += delta;
          current = parseFloat(current.toFixed(2));
          rafId = requestAnimationFrame(updateAnimation);
        } else {
          current = target;
          rafActive = false;
          cancelAnimationFrame(rafId);
        }

        updateAnimationItems();
      }

      function startAnimation(){
        if (!rafActive){
          rafActive = true;
          rafId = requestAnimationFrame(updateAnimation);
        }
      }

      function updateScroll(){
        target = window.scrollY || window.pageYOffset;
        startAnimation();
      }

      window.addEventListener('scroll', updateScroll, { passive: true });
      window.addEventListener('resize', () => { target = window.scrollY; startAnimation(); });

      updateScroll();
    })();

  window.scrollRow = scrollRow; //so the onclick in html can find it
})();
}

//report lost form
if (document.getElementById('lostForm')) {
(function(){
  const uploadZone   = document.getElementById('uploadZone');
  const photoInput   = document.getElementById('photoInput');
  const previewRow   = document.getElementById('previewRow');
  const fileName     = document.getElementById('fileName');
  const fileSize     = document.getElementById('fileSize');
  const removePhoto  = document.getElementById('removePhoto');
  const rekStatus    = document.getElementById('rekStatus');
  const rekDot       = document.getElementById('rekDot');
  const rekText      = document.getElementById('rekText');
  const labelChips   = document.getElementById('labelChips');

  let uploadedImageKey = null;
  let uploadedRedactedImageKey = null;
  let detectedLabels = [];
  let detectedDominantRgb = null;
  let detectedCustomTopLabel = null;
  let detectedCustomLabels = [];
  let detectedAiDescription = null;
  

  //uploads
  uploadZone.addEventListener('click', () => photoInput.click());

  ['dragover','dragenter'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    })
  );

  ['dragleave','drop'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    })
  );

  uploadZone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  photoInput.addEventListener('change', () => {
    if (photoInput.files.length) {
      handleFile(photoInput.files[0]);
    }
  });

  function handleFile(file){
    fileName.textContent = file.name;
    fileSize.textContent = (file.size / 1024).toFixed(0) + ' KB';

    //once a photo is picked the big upload box doesnt need to stay there
    previewRow.style.display = 'flex';

    analyseImage(file);
  }

  removePhoto.addEventListener('click', () => {
    photoInput.value = '';
    previewRow.style.display = 'none';
    rekStatus.style.display = 'none';
    labelChips.innerHTML = '';

    uploadedImageKey = null;
    uploadedRedactedImageKey = null;
    detectedLabels = [];
    detectedDominantRgb = null;
    detectedCustomTopLabel = null;
    detectedCustomLabels = [];
    detectedAiDescription = null;
    
  });

  //for calling AWS Rekognition
  function analyseImage(file){
    labelChips.innerHTML = '';

    uploadedImageKey = null;
    uploadedRedactedImageKey = null;
    detectedLabels = [];
    detectedDominantRgb = null;
    detectedCustomTopLabel = null;
    detectedCustomLabels = [];
    detectedAiDescription = null;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      rekStatus.style.display = 'flex';
      rekDot.classList.remove('loading');
      rekText.textContent = 'Please upload a JPG or PNG image.';
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      rekStatus.style.display = 'flex';
      rekDot.classList.remove('loading');
      rekText.textContent = 'Image must be 6MB or smaller.';
      return;
    }

    rekStatus.style.display = 'flex';
    rekDot.classList.add('loading');
    rekText.textContent = 'Analyzing image with AWS Rekognition…';

    const reader = new FileReader();

    reader.onload = async function(){
      try {
        const token = sessionStorage.getItem('back2u_access_token');

        if (!token) {
          throw new Error('Please sign in before analysing an image');
        }

        const response = await fetch(
          'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/predict',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
              image_base64: reader.result,
              filename: file.name,
              content_type: file.type
            })
          }
        );

        if (!response.ok) {
          throw new Error('AWS request failed');
        }

        const data = await response.json();

        uploadedImageKey = data.image_key;
        //lambda gives back a censored copy
        uploadedRedactedImageKey = data.redacted_image_key || null;
        detectedLabels = data.labels || [];
        detectedDominantRgb = data.dominant_rgb || null;
        detectedCustomTopLabel = data.custom_top_label || null;
        detectedCustomLabels = data.custom_labels || [];
        detectedAiDescription = data.ai_description || null;
        

        renderLabels(detectedLabels);

        console.log('AWS image key:', uploadedImageKey);
        console.log('AWS redacted image key:', uploadedRedactedImageKey);
        console.log('AWS labels:', detectedLabels);
        console.log('AWS dominant colour:', detectedDominantRgb);
        console.log('AWS custom model status:', data.custom_model_status);
        console.log('AWS custom top label:', detectedCustomTopLabel);
        console.log('AWS custom labels:', detectedCustomLabels);


      } catch (error) {
        console.error('Rekognition error:', error);

        rekDot.classList.remove('loading');
        rekText.textContent = 'Could not analyse image. Please try again.';
        labelChips.innerHTML = '';
      }
    };

    reader.onerror = function(){
      rekDot.classList.remove('loading');
      rekText.textContent = 'Could not read image. Please try again.';
    };

    reader.readAsDataURL(file);
  }

  function renderLabels(labels){
    rekStatus.style.display = 'flex';
    rekDot.classList.remove('loading');

    rekText.textContent =
      'Labels detected — these help us match your report automatically.';

    labelChips.innerHTML = '';

    labels.forEach(l => {
      const chip = document.createElement('span');
      chip.className = 'label-chip';
      chip.textContent = l.name;

      const conf = document.createElement('span');
      conf.className = 'conf';
      conf.textContent = l.confidence + '%';

      chip.appendChild(conf);
      labelChips.appendChild(chip);
    });
  }

  async function submitLostReport(payload){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token) {
      throw new Error('Please sign in before submitting a report');
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Could not submit report');
    }

    return await response.json();
  }

  //runs the matching lambda after the report is saved
  async function runMatching(reportId){
    const token = sessionStorage.getItem('back2u_access_token');

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/match',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          report_id: reportId
        })
      }
    );

    if (!response.ok) {
      throw new Error('Could not run matching');
    }

    return await response.json();
  }

  document.getElementById('lostForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    //stops the form saving null image keys if rekognition is still running
    if (photoInput.files.length && !uploadedImageKey) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Report';
      alert('Please wait for the image analysis to finish.');
      return;
    }

    const reportId = 'LOST-' + Date.now();

    const payload = {
      report_id: reportId,

      report_type: 'lost',
      category: document.getElementById('category').value,
      manual_color: document.getElementById('color').value,
      area: document.getElementById('area').value,
      event_date: document.getElementById('dateLost').value,
      details: document.getElementById('detail').value,
      image_key: uploadedImageKey,
      redacted_image_key: uploadedRedactedImageKey,
      dominant_rgb: detectedDominantRgb,
      labels: detectedLabels,
      custom_label: detectedCustomTopLabel?.name || null,
      custom_confidence: detectedCustomTopLabel?.confidence ?? null,
      ai_description: detectedAiDescription
    };

    try {
      const result = await submitLostReport(payload);

      console.log('Report saved to RDS:', result);

      try {
        const matchResult = await runMatching(reportId);
        console.log('Matching completed:', matchResult);
      } catch (matchError) {
        console.error('Matching error:', matchError);
      }

      document.getElementById('formView').style.display = 'none';
      document.getElementById('confirmView').style.display = 'block';
      window.scrollTo(0, 0);
    } catch (error) {
      console.error('Submit report error:', error);

      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Report';

      alert('Could not submit your report. Please try again.');
    }
  });
})();
}

//report found form
if (document.getElementById('foundForm')) {
(function(){
  const uploadZone   = document.getElementById('uploadZone');
  const photoInput   = document.getElementById('photoInput');
  const previewRow   = document.getElementById('previewRow');
  const fileName     = document.getElementById('fileName');
  const fileSize     = document.getElementById('fileSize');
  const removePhoto  = document.getElementById('removePhoto');
  const rekStatus    = document.getElementById('rekStatus');
  const rekDot       = document.getElementById('rekDot');
  const rekText      = document.getElementById('rekText');
  const labelChips   = document.getElementById('labelChips');
  const stillHaveItem = document.getElementById('stillHaveItem');
  const handoverVenue = document.getElementById('handoverVenue');
  const handoverVenueLabel = document.getElementById('handoverVenueLabel');
  const handoverVenueHint = document.getElementById('handoverVenueHint');

  let uploadedImageKey = null;
  let detectedLabels = [];
  let detectedDominantRgb = null;
  let detectedCustomTopLabel = null;
  let detectedCustomLabels = [];
  let detectedAiDescription = null;
  let uploadedRedactedImageKey = null;

  uploadZone.addEventListener('click', () => photoInput.click());

  ['dragover','dragenter'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    })
  );

  ['dragleave','drop'].forEach(evt =>
    uploadZone.addEventListener(evt, e => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    })
  );

  uploadZone.addEventListener('drop', e => {
    if (e.dataTransfer.files.length) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  photoInput.addEventListener('change', () => {
    if (photoInput.files.length) {
      handleFile(photoInput.files[0]);
    }
  });

  function handleFile(file){
    fileName.textContent = file.name;
    fileSize.textContent = (file.size / 1024).toFixed(0) + ' KB';

    //once a photo is picked the big upload box doesnt need to stay there
    previewRow.style.display = 'flex';

    analyseImage(file);
  }

  removePhoto.addEventListener('click', () => {
    photoInput.value = '';
    previewRow.style.display = 'none';
    rekStatus.style.display = 'none';
    labelChips.innerHTML = '';

    uploadedImageKey = null;
    uploadedRedactedImageKey = null;
    detectedLabels = [];
    detectedDominantRgb = null;
    detectedCustomTopLabel = null;
    detectedCustomLabels = [];
    detectedAiDescription = null;
  });

  function analyseImage(file){
    labelChips.innerHTML = '';

    uploadedImageKey = null;
    uploadedRedactedImageKey = null;
    detectedLabels = [];
    detectedDominantRgb = null;
    detectedCustomTopLabel = null;
    detectedCustomLabels = [];
    detectedAiDescription = null;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      rekStatus.style.display = 'flex';
      rekDot.classList.remove('loading');
      rekText.textContent = 'Please upload a JPG or PNG image.';
      return;
    }

    if (file.size > 6 * 1024 * 1024) {
      rekStatus.style.display = 'flex';
      rekDot.classList.remove('loading');
      rekText.textContent = 'Image must be 6MB or smaller.';
      return;
    }

    rekStatus.style.display = 'flex';
    rekDot.classList.add('loading');
    rekText.textContent = 'Analyzing image with AWS Rekognition…';

    const reader = new FileReader();

    reader.onload = async function(){
      try {
        const token = sessionStorage.getItem('back2u_access_token');

        if (!token) {
          throw new Error('Please sign in before analysing an image');
        }

        const response = await fetch(
          'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/predict',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({
              image_base64: reader.result,
              filename: file.name,
              content_type: file.type
            })
          }
        );

        if (!response.ok) {
          throw new Error('AWS request failed');
        }

        const data = await response.json();

        uploadedImageKey = data.image_key;
        //keeps the censored s3 copy separately from the original
        uploadedRedactedImageKey = data.redacted_image_key || null;
        detectedLabels = data.labels || [];
        detectedDominantRgb = data.dominant_rgb || null;
        detectedCustomTopLabel = data.custom_top_label || null;
        detectedCustomLabels = data.custom_labels || [];
        detectedAiDescription = data.ai_description || null;

        renderLabels(detectedLabels);

        console.log('AWS image key:', uploadedImageKey);
        console.log('AWS labels:', detectedLabels);
        console.log('AWS dominant colour:', detectedDominantRgb);
        console.log('AWS custom model status:', data.custom_model_status);
        console.log('AWS custom top label:', detectedCustomTopLabel);
        console.log('AWS custom labels:', detectedCustomLabels);
        console.log('AWS redacted image key:', uploadedRedactedImageKey);

      } catch (error) {
        console.error('Rekognition error:', error);

        rekDot.classList.remove('loading');
        rekText.textContent = 'Could not analyse image. Please try again.';
        labelChips.innerHTML = '';
      }
    };

    reader.onerror = function(){
      rekDot.classList.remove('loading');
      rekText.textContent = 'Could not read image. Please try again.';
    };

    reader.readAsDataURL(file);
  }

  function renderLabels(labels){
    rekStatus.style.display = 'flex';
    rekDot.classList.remove('loading');

    rekText.textContent =
      'Labels detected — these help us match this against active lost reports.';

    labelChips.innerHTML = '';

    labels.forEach(l => {
      const chip = document.createElement('span');
      chip.className = 'label-chip';
      chip.textContent = l.name;

      const conf = document.createElement('span');
      conf.className = 'conf';
      conf.textContent = l.confidence + '%';

      chip.appendChild(conf);
      labelChips.appendChild(chip);
    });
  }

  async function submitFoundReport(payload){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token) {
      throw new Error('Please sign in before submitting a report');
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      throw new Error('Could not submit report');
    }

    return await response.json();
  }

  //same matcher here too because the lost and found forms are separate blocks
  async function runMatching(reportId){
    const token = sessionStorage.getItem('back2u_access_token');

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/match',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          report_id: reportId
        })
      }
    );

    if (!response.ok) {
      throw new Error('Could not run matching');
    }

    return await response.json();
  }

  stillHaveItem.addEventListener('change', () => {
    if (stillHaveItem.checked) {
      handoverVenueLabel.textContent =
        'If a match is confirmed, where will you hand it in for collection?';

      handoverVenue.placeholder =
        'e.g. Block 3 General Office';

      handoverVenueHint.textContent =
        'You can keep the item for now. Enter the collection point you will hand it to if a match is confirmed.';

    } else {
      handoverVenueLabel.textContent =
        'Where did you hand the item in?';

      handoverVenue.placeholder =
        'e.g. Block 3 General Office';

      handoverVenueHint.textContent =
        'If a match is confirmed, the owner will be shown this collection location.';
    }
  });



  document.getElementById('foundForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    //same check here so a found report does not save before the image is ready
    if (photoInput.files.length && !uploadedImageKey) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Report';
      alert('Please wait for the image analysis to finish.');
      return;
    }

    const reportId = 'FOUND-' + Date.now();

    const payload = {
      report_id: reportId,

      report_type: 'found',
      category: document.getElementById('category').value,
      manual_color: document.getElementById('color').value,
      area: document.getElementById('area').value,
      event_date: document.getElementById('dateFound').value,
      details: document.getElementById('detail').value,
      handover_venue: document.getElementById('handoverVenue').value,
      image_key: uploadedImageKey,
      redacted_image_key: uploadedRedactedImageKey,
      dominant_rgb: detectedDominantRgb,
      labels: detectedLabels,
      custom_label: detectedCustomTopLabel?.name || null,
      custom_confidence: detectedCustomTopLabel?.confidence ?? null,
      ai_description: detectedAiDescription
    };

    try {
      const result = await submitFoundReport(payload);

      console.log('Found report saved to RDS:', result);

      try {
        const matchResult = await runMatching(reportId);
        console.log('Matching completed:', matchResult);
      } catch (matchError) {
        console.error('Matching error:', matchError);
      }

      document.getElementById('formView').style.display = 'none';
      document.getElementById('confirmView').style.display = 'block';
      window.scrollTo(0, 0);
    } catch (error) {
      console.error('Submit found report error:', error);

      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Report';

      alert('Could not submit your report. Please try again.');
    }
  });
})();
}

//login signup
if (document.getElementById('loginForm')) {
(function(){
  //switches between login tab and signup tab
  function showPanel(which){
    document.getElementById('tabLogin')
      .classList.toggle(
        'active',
        which === 'login'
      );

    document.getElementById('tabSignup')
      .classList.toggle(
        'active',
        which === 'signup'
      );

    document.getElementById('panelLogin')
      .classList.toggle(
        'active',
        which === 'login'
      );

    document.getElementById('panelSignup')
      .classList.toggle(
        'active',
        which === 'signup'
      );

    document.getElementById('panelForgot')
      .classList.toggle(
        'active',
        which === 'forgot'
      );
  }

  //checks url for ?mode=signup so a link can open straight to signup tab
  const params = new URLSearchParams(window.location.search);
  showPanel(params.get('mode') === 'signup' ? 'signup' : 'login');

  //cognito login
  const COGNITO_CLIENT_ID = '2lbs1a9n0khdfj6pmld83ql276';

  const COGNITO_ENDPOINT =
    'https://cognito-idp.us-east-1.amazonaws.com/';


  async function cognitoRequest(action, body){
    const response = await fetch(
      COGNITO_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target':
            'AWSCognitoIdentityProviderService.' + action
        },
        body: JSON.stringify(body)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message ||
        data.Message ||
        'Cognito request failed'
      );
    }

    return data;
  }


  async function cognitoLogin(email, password){
    const start = await cognitoRequest(
      'InitiateAuth',
      {
        AuthFlow: 'USER_AUTH',

        ClientId: COGNITO_CLIENT_ID,

        AuthParameters: {
          USERNAME: email,
          PREFERRED_CHALLENGE: 'PASSWORD',
          PASSWORD: password
        }
      }
    );

    if (start.AuthenticationResult) {
      return start.AuthenticationResult;
    }

    if (start.ChallengeName === 'PASSWORD') {
      const username =
        start.ChallengeParameters?.USERNAME ||
        email;

      const finish = await cognitoRequest(
        'RespondToAuthChallenge',
        {
          ChallengeName: 'PASSWORD',

          ClientId: COGNITO_CLIENT_ID,

          Session: start.Session,

          ChallengeResponses: {
            USERNAME: username,
            PASSWORD: password
          }
        }
      );

      if (finish.AuthenticationResult) {
        return finish.AuthenticationResult;
      }

      throw new Error(
        'Cognito did not return authentication tokens'
      );
    }

    if (start.ChallengeName === 'SELECT_CHALLENGE') {
      const username =
        start.ChallengeParameters?.USERNAME ||
        email;

      const finish = await cognitoRequest(
        'RespondToAuthChallenge',
        {
          ChallengeName: 'SELECT_CHALLENGE',

          ClientId: COGNITO_CLIENT_ID,

          Session: start.Session,

          ChallengeResponses: {
            USERNAME: username,
            ANSWER: 'PASSWORD',
            PASSWORD: password
          }
        }
      );

      if (finish.AuthenticationResult) {
        return finish.AuthenticationResult;
      }

      throw new Error(
        'Cognito did not return authentication tokens'
      );
    }

    throw new Error(
      'Unexpected sign-in challenge: ' +
      (start.ChallengeName || 'unknown')
    );
  }

  //cognito signup
  async function cognitoSignup(name, email, password){
    return await cognitoRequest(
      'SignUp',
      {
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        Password: password,
        UserAttributes: [
          {
            Name: 'email',
            Value: email
          },
          {
            Name: 'name',
            Value: name
          }
        ]
      }
    );
  }


  async function confirmCognitoSignup(email, code){
    return await cognitoRequest(
      'ConfirmSignUp',
      {
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ConfirmationCode: code
      }
    );
  }


  //starts cognito's password reset flow
  async function forgotCognitoPassword(email){
    return await cognitoRequest(
      'ForgotPassword',
      {
        ClientId: COGNITO_CLIENT_ID,
        Username: email
      }
    );
  }


  //finishes the reset using the emailed code
  async function confirmForgotCognitoPassword(
    email,
    code,
    newPassword
  ){
    return await cognitoRequest(
      'ConfirmForgotPassword',
      {
        ClientId: COGNITO_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword
      }
    );
  }

  let forgotCodeSent = false;


  document.getElementById(
    'forgotPasswordLink'
  ).addEventListener(
    'click',
    (e) => {
      e.preventDefault();

      const loginEmail =
        document.getElementById(
          'loginEmail'
        ).value;

      document.getElementById(
        'forgotEmail'
      ).value = loginEmail;

      showPanel('forgot');
    }
  );


  document.getElementById(
    'forgotPasswordForm'
  ).addEventListener(
    'submit',
    async (e) => {
      e.preventDefault();

      const btn =
        document.getElementById(
          'forgotPasswordBtn'
        );

      const status =
        document.getElementById(
          'forgotPasswordStatus'
        );

      const email =
        document.getElementById(
          'forgotEmail'
        ).value.trim();

      btn.disabled = true;
      status.style.display = 'flex';


      try {
        //first submit sends the code
        if (!forgotCodeSent){
          await forgotCognitoPassword(
            email
          );

          forgotCodeSent = true;

          document.getElementById(
            'forgotCodeFields'
          ).style.display = 'block';

          document.getElementById(
            'forgotCode'
          ).required = true;

          document.getElementById(
            'forgotNewPassword'
          ).required = true;

          status.textContent =
            'Verification code sent. Check your email.';

          btn.textContent =
            'Reset Password';

          return;
        }


        const code =
          document.getElementById(
            'forgotCode'
          ).value.trim();

        const newPassword =
          document.getElementById(
            'forgotNewPassword'
          ).value;

        await confirmForgotCognitoPassword(
          email,
          code,
          newPassword
        );

        document.getElementById(
          'loginEmail'
        ).value = email;

        document.getElementById(
          'loginPassword'
        ).value = '';

        status.textContent =
          'Password reset successfully. You can sign in now.';

        forgotCodeSent = false;

        document.getElementById(
          'forgotPasswordForm'
        ).reset();

        document.getElementById(
          'forgotCodeFields'
        ).style.display = 'none';

        btn.textContent =
          'Send Verification Code';

        setTimeout(() => {
          showPanel('login');

          document.getElementById(
            'loginStatus'
          ).style.display = 'flex';

          document.getElementById(
            'loginStatus'
          ).textContent =
            'Password reset successfully. Sign in with your new password.';
        }, 900);


      } catch (error){
        console.error(
          'Password reset error:',
          error
        );

        status.textContent =
          error.message;

      } finally {
        btn.disabled = false;
      }
    }
  );

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('loginBtn');
    const status = document.getElementById('loginStatus');

    btn.disabled = true;
    btn.textContent = 'Signing In…';

    status.style.display = 'flex';
    status.textContent = 'Signing in securely with Amazon Cognito…';

    try {
      const auth = await cognitoLogin(
        document.getElementById('loginEmail').value,
        document.getElementById('loginPassword').value
      );

      sessionStorage.setItem(
        'back2u_access_token',
        auth.AccessToken
      );

      sessionStorage.setItem(
        'back2u_id_token',
        auth.IdToken
      );

      if (auth.RefreshToken) {
        sessionStorage.setItem(
          'back2u_refresh_token',
          auth.RefreshToken
        );
      }

      sessionStorage.setItem(
        'back2u_user_session',
        'active'
      );

      window.location.href = 'my_reports.html';

    } catch (error) {
      console.error('Cognito login error:', error);

      status.style.display = 'flex';
      status.textContent = error.message;

      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('signupBtn');
    const status = document.getElementById('signupStatus');
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;

    btn.disabled = true;
    btn.textContent = 'Creating Account…';

    status.style.display = 'flex';
    status.textContent = 'Creating your account with Amazon Cognito…';

    try {
      const result = await cognitoSignup(
        name,
        email,
        password
      );

      if (!result.UserConfirmed) {
        const code = window.prompt(
          'Enter the verification code sent to ' + email
        );

        if (!code) {
          throw new Error(
            'Your account was created. Enter the email verification code to finish signing up.'
          );
        }

        //cognito emails this code before the account can be used
        await confirmCognitoSignup(
          email,
          code.trim()
        );
      }

      status.textContent =
        'Account verified. You can sign in now.';

      document.getElementById('loginEmail').value = email;
      showPanel('login');

    } catch (error) {
      console.error('Cognito signup error:', error);

      status.style.display = 'flex';
      status.textContent = error.message;

    } finally {
      btn.disabled = false;
      btn.textContent = 'Create Account';
    }
  });

  window.showPanel = showPanel;
})();
}

//my reports
if (document.getElementById('reportsList')) {
(function(){
  let reports = [];


  //gets a temporary secure image url from the backend
  async function getSecureImageUrl(reportId){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token){
      return null;
    }

    try {
      const response = await fetch(
        'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports/' +
        encodeURIComponent(reportId) +
        '/image',
        {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        }
      );

      if (!response.ok){
        return null;
      }

      const data = await response.json();

      return data.image_url || null;

    } catch (error){
      console.error('Load report image error:', error);
      return null;
    }
  }


  async function loadMyReports(){
    try {
      const token = sessionStorage.getItem('back2u_access_token');

      if (!token){
        throw new Error('Please sign in to view your reports');
      }

      const response = await fetch(
        'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/my-reports',
        {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        }
      );

      if (!response.ok){
        throw new Error('Could not load reports');
      }

      const data = await response.json();

      reports = data.map(r => ({
        id: r.report_id,
        type: r.report_type,

        title:
          (r.manual_color ? r.manual_color + ' ' : '') +
          r.category,

        area: r.area,
        date: r.event_date,
        status: r.status,

        handoverVenue: r.handover_venue,

        imageKey:
          r.image_key ||
          r.redacted_image_key ||
          null,

        imageUrl: null,

        matches: (r.matches || []).map(m => ({
          id: m.match_id,
          reportId: m.matched_report_id,
          type: m.matched_report_type,

          title:
            (m.matched_manual_color
              ? m.matched_manual_color + ' '
              : '') +
            m.matched_category,

          loc: m.matched_area,
          date: m.matched_event_date,

          handoverVenue:
            m.matched_handover_venue,

          imageKey:
            m.matched_image_key || null,

          imageUrl: null,

          confidence:
            Number(m.overall_score),

          labelScore:
            Number(m.label_score),

          colorScore:
            Number(m.color_score),

          locationScore:
            Number(m.location_score),

          detailScore:
            Number(m.detail_score),

          status:
            m.match_status
        }))
      }));


      //loads my own report image and the possible match images
      await Promise.all(
        reports.flatMap(r => {
          const imageLoads = [];

          if (r.imageKey){
            imageLoads.push(
              (async () => {
                r.imageUrl =
                  await getSecureImageUrl(r.id);
              })()
            );
          }

          r.matches.forEach(m => {
            if (m.imageKey){
              imageLoads.push(
                (async () => {
                  m.imageUrl =
                    await getSecureImageUrl(
                      m.reportId
                    );
                })()
              );
            }
          });

          return imageLoads;
        })
      );

      return reports;

    } catch (error){
      console.error(
        'Load reports error:',
        error
      );

      reports = [];
      return reports;
    }
  }


  async function updateMatchStatus(
    matchId,
    status
  ){
    const token =
      sessionStorage.getItem(
        'back2u_access_token'
      );

    if (!token){
      throw new Error(
        'Please sign in first'
      );
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/matches/' +
      encodeURIComponent(matchId),
      {
        method: 'PUT',

        headers: {
          'Content-Type':
            'application/json',

          'Authorization':
            'Bearer ' + token
        },

        body: JSON.stringify({
          status: status
        })
      }
    );

    if (!response.ok){
      const errorData =
        await response.json()
          .catch(() => ({}));

      throw new Error(
        errorData.message ||
        errorData.error ||
        'Could not update match'
      );
    }

    return await response.json();
  }


  async function handleSendForReview(
    reportId,
    matchId
  ){
    if (!confirm(
      'Send this possible match to staff for review?'
    )){
      return;
    }

    try {
      await updateMatchStatus(
        matchId,
        'needs_review'
      );

      await loadMyReports();
      render();

      alert(
        'Possible match sent to staff for review. You can check its progress under Under Staff Review.'
      );

    } catch (error){
      console.error(
        'Match review error:',
        error
      );

      alert(
        'Could not send this match for review. Please try again.'
      );
    }
  }


  async function handleRejectCandidate(
    reportId,
    matchId
  ){
    if (!confirm(
      'Remove this possible match?'
    )){
      return;
    }

    try {
      await updateMatchStatus(
        matchId,
        'rejected'
      );

      await loadMyReports();
      render();

    } catch (error){
      console.error(
        'Reject match error:',
        error
      );

      alert(
        'Could not reject this match. Please try again.'
      );
    }
  }


  async function deleteReport(reportId){
    const token =
      sessionStorage.getItem(
        'back2u_access_token'
      );

    if (!token){
      throw new Error(
        'Please sign in first'
      );
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports/' +
      encodeURIComponent(reportId),
      {
        method: 'DELETE',

        headers: {
          'Authorization':
            'Bearer ' + token
        }
      }
    );

    if (!response.ok){
      const errorData =
        await response.json()
          .catch(() => ({}));

      throw new Error(
        errorData.message ||
        errorData.error ||
        'Could not delete report'
      );
    }

    const result =
      await response.json();

    reports =
      reports.filter(
        r => r.id !== reportId
      );

    return result;
  }


  function statusMeta(status){
    if (status === 'active'){
      return {
        cls: 'status-active',
        label: 'Active'
      };
    }

    if (status === 'needs_review'){
      return {
        cls: 'status-review',
        label: 'Needs Review'
      };
    }

    return {
      cls: 'status-resolved',
      label: 'Resolved'
    };
  }


  function itemImage(
    imageUrl,
    altText,
    size = 56
  ){
    if (imageUrl){
      return `
        <div
          class="match-thumb"
          style="
            width:${size}px;
            height:${size}px;
          "
        >
          <img
            src="${imageUrl}"
            alt="${escapeHtml(altText)}"
            style="
              width:100%;
              height:100%;
              object-fit:cover;
            "
          >
        </div>
      `;
    }

    return `
      <div
        class="match-thumb"
        style="
          width:${size}px;
          height:${size}px;
        "
      >
        <svg viewBox="0 0 24 24">
          <rect
            x="3"
            y="7"
            width="18"
            height="13"
            rx="2"
          />
          <path d="M3 10h18"/>
        </svg>
      </div>
    `;
  }


  //builds html for one report card
  function buildCard(r){
    const confirmedMatch =
      r.matches.find(
        m => m.status === 'confirmed'
      );

    const hasReview =
      r.matches.some(
        m => m.status === 'needs_review'
      );

    const displayStatus =
      confirmedMatch
        ? 'resolved'
        : hasReview
        ? 'needs_review'
        : r.status;

    const s =
      statusMeta(displayStatus);

    const card =
      document.createElement('div');

    card.className =
      'report-card';

    card.style.cursor = 'pointer';

    card.addEventListener('click', () => {
      window.location.href =
        'report_details.html?report_id=' +
        encodeURIComponent(r.id);
    });

    let matchHtml = '';


    const possibleMatches =
      r.matches.filter(
        m =>
          m.status === 'candidate' ||
          m.status === 'needs_review'
      );


    //possible matches
    if (
      !confirmedMatch &&
      displayStatus !== 'resolved' &&
      possibleMatches.length > 0
    ){
      matchHtml = `
        <div class="match-block">

          <div class="match-head">
            <span class="match-label">
              Possible Matches
            </span>

            <span class="confidence conf-mid">
              ${possibleMatches.length}
              candidate${possibleMatches.length === 1 ? '' : 's'}
            </span>
          </div>


          ${possibleMatches.map(
            (m, index) => {

              const confClass =
                m.confidence >= 80
                  ? 'conf-high'
                  : 'conf-mid';

              return `
                <div
                  class="match-card"
                  style="margin-bottom:10px;"
                >

                  ${itemImage(
                    m.imageUrl,
                    'Possible matched item',
                    64
                  )}

                  <div class="match-info">

                    <div
                      class="match-label"
                      style="margin-bottom:4px;"
                    >
                      Match ${index + 1}
                    </div>

                    <div class="m-title">
                      ${escapeHtml(m.title)}
                    </div>

                    <div class="m-loc">
                      ${escapeHtml(m.loc)} · ${escapeHtml(m.date)}
                    </div>

                    <div
                      style="
                        margin-top:7px;
                        font-size:11.5px;
                        color:var(--ink-soft);
                      "
                    >
                      Item ${m.labelScore.toFixed(2)}%
                      · Colour ${m.colorScore.toFixed(2)}%
                      · Location ${m.locationScore.toFixed(2)}%
                      · Details ${m.detailScore.toFixed(2)}%
                    </div>


                    ${
                      m.status === 'candidate' &&
                      !hasReview
                        ? `
                          <div
                            class="match-btns"
                            style="margin-top:10px;"
                          >

                            <button
                              class="btn btn-dark"
                              onclick="event.stopPropagation(); handleSendForReview(
                                '${r.id}',
                                '${m.id}'
                              )"
                            >
                              ${
                                r.type === 'lost'
                                  ? 'This Could Be Mine'
                                  : 'Possible Owner'
                              }
                            </button>

                            <button
                              class="btn"
                              onclick="event.stopPropagation(); handleRejectCandidate(
                                '${r.id}',
                                '${m.id}'
                              )"
                            >
                              ${
                                r.type === 'lost'
                                  ? 'Not Mine'
                                  : 'Not a Match'
                              }
                            </button>

                          </div>
                        `
                        : m.status === 'needs_review'
                        ? `
                          <div
                            class="review-note"
                            style="margin-top:10px;"
                          >
                            ✹ Waiting for staff review
                          </div>
                        `
                        : ''
                    }

                  </div>


                  <span
                    class="confidence ${confClass}"
                  >
                    ${m.confidence.toFixed(2)}%
                  </span>

                </div>
              `;
            }
          ).join('')}


          ${
            hasReview
              ? `
                <div class="review-note">
                  ✹ Sent to staff for review — staff will compare this with the other AI suggestions.
                </div>
              `
              : ''
          }

        </div>
      `;
    }


    //confirmed match
    else if (confirmedMatch){
      const m = confirmedMatch;

      let confirmationText =
        '✓ Match confirmed by staff';

      if (
        r.type === 'lost' &&
        m.handoverVenue
      ){
        confirmationText =
          '✓ Confirmed by staff · Collect at ' +
          escapeHtml(m.handoverVenue);
      }

      else if (
        r.type === 'found' &&
        r.handoverVenue
      ){
        confirmationText =
          '✓ Confirmed by staff · Handover point: ' +
          escapeHtml(r.handoverVenue);
      }


      matchHtml = `
        <div class="match-block">

          <div class="match-head">

            <span class="match-label">
              Matched With
            </span>

            <span
              class="confidence conf-high"
            >
              ${m.confidence.toFixed(2)}%
              confidence
            </span>

          </div>


          <div class="match-card">

            ${itemImage(
              m.imageUrl,
              'Confirmed matched item',
              64
            )}

            <div class="match-info">

              <div class="m-title">
                ${escapeHtml(m.title)}
              </div>

              <div class="m-loc">
                ${escapeHtml(m.loc)} · ${escapeHtml(m.date)}
              </div>

            </div>


            <div
              class="review-note"
              style="margin:0 0 0 auto;"
            >
              ${confirmationText}
            </div>

          </div>

        </div>
      `;
    }


    card.innerHTML = `
      <div class="report-top">

        <div
          style="
            display:flex;
            align-items:center;
            gap:16px;
          "
        >

          ${itemImage(
            r.imageUrl,
            r.type + ' item',
            72
          )}

          <div>

            <div class="report-type">
              ${
                r.type === 'lost'
                  ? 'Lost Item'
                  : 'Found Item'
              }
              · ${r.id}
            </div>

            <div class="report-title">
              ${escapeHtml(r.title)}
            </div>

            <div class="report-meta">
              ${escapeHtml(r.area)} · ${escapeHtml(r.date)}
            </div>

          </div>

        </div>


        <div class="report-actions">

          <span
            class="status-pill ${s.cls}"
          >
            <span class="dot"></span>
            ${s.label}
          </span>

          <span
            class="icon-btn"
            title="Delete report"
            onclick="event.stopPropagation(); handleDelete('${r.id}')"
          >
            ✕
          </span>

        </div>

      </div>

      ${matchHtml}
    `;

    return card;
  }


  function render(){
    const list =
      document.getElementById(
        'reportsList'
      );

    list.innerHTML = '';

    if (reports.length === 0){
      list.innerHTML = `
        <div class="empty-state">
          No reports yet.
          <a
            href="report_lost.html"
            style="text-decoration:underline;"
          >
            Report a lost item
          </a>
          to get started.
        </div>
      `;

      return;
    }


    const sections = [

      {
        label:
          'Needs Your Attention',

        reports:
          reports.filter(r =>
            r.status === 'active' &&

            !r.matches.some(
              m =>
                m.status === 'confirmed'
            ) &&

            !r.matches.some(
              m =>
                m.status === 'needs_review'
            ) &&

            r.matches.some(
              m =>
                m.status === 'candidate'
            )
          )
      },


      {
        label:
          'Under Staff Review',

        reports:
          reports.filter(r =>
            !r.matches.some(
              m =>
                m.status === 'confirmed'
            ) &&

            r.matches.some(
              m =>
                m.status === 'needs_review'
            )
          )
      },


      {
        label:
          'Waiting for a Match',

        reports:
          reports.filter(r =>
            r.status === 'active' &&

            !r.matches.some(
              m =>
                m.status === 'candidate' ||
                m.status === 'needs_review' ||
                m.status === 'confirmed'
            )
          )
      },


      {
        label:
          'Resolved',

        reports:
          reports.filter(r =>
            r.status === 'resolved' ||

            r.matches.some(
              m =>
                m.status === 'confirmed'
            )
          )
      }

    ];


    sections.forEach(
      section => {

        if (
          section.reports.length === 0
        ){
          return;
        }

        const heading =
          document.createElement(
            'div'
          );

        heading.className =
          'section-label';

        heading.textContent =
          section.label;

        list.appendChild(
          heading
        );


        section.reports.forEach(
          r =>
            list.appendChild(
              buildCard(r)
            )
        );
      }
    );
  }


  async function handleDelete(id){
    if (!confirm(
      "Remove this report? This can't be undone."
    )){
      return;
    }

    try {
      await deleteReport(id);
      render();

    } catch (error){
      alert(
        'Could not remove this report. Please try again.'
      );
    }
  }


  const token =
    sessionStorage.getItem(
      'back2u_access_token'
    );

  if (
    sessionStorage.getItem(
      'back2u_user_session'
    ) !== 'active' ||
    !token
  ){
    document.getElementById(
      'reportsList'
    ).innerHTML = `
      <div
        class="empty-state"
        style="padding:80px 20px;"
      >
        <p
          style="
            font-size:16px;
            color:var(--ink);
            margin-bottom:20px;
          "
        >
          Log in or create an account to see your reports and matches.
        </p>

        <div
          style="
            display:flex;
            gap:12px;
            justify-content:center;
          "
        >
          <a
            class="btn"
            href="login.html"
          >
            Login
          </a>

          <a
            class="btn btn-dark"
            href="login.html?mode=signup"
          >
            Sign Up
          </a>
        </div>
      </div>
    `;

  } else {
    loadMyReports()
      .then(() => render());
  }


  window.handleDelete =
    handleDelete;

  window.handleSendForReview =
    handleSendForReview;

  window.handleRejectCandidate =
    handleRejectCandidate;

})();
}

//report details page
if (document.getElementById('reportDetails')) {
(async function(){

  const container =
    document.getElementById('reportDetails');

  const token =
    sessionStorage.getItem('back2u_access_token');

  if (!token){
    window.location.href = 'login.html';
    return;
  }


  const params =
    new URLSearchParams(window.location.search);

  const reportId =
    params.get('report_id');


  if (!reportId){
    container.innerHTML = `
      <div class="empty-state">
        Report not found.
      </div>
    `;
    return;
  }


  async function getSecureImageUrl(reportId){
    try {
      const response = await fetch(
        'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports/' +
        encodeURIComponent(reportId) +
        '/image',
        {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        }
      );

      if (!response.ok){
        return null;
      }

      const data = await response.json();

      return data.image_url || null;

    } catch (error){
      console.error(
        'Load report image error:',
        error
      );

      return null;
    }
  }


  try {
    //uses the secure user-scoped endpoint
    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/my-reports',
      {
        headers: {
          'Authorization': 'Bearer ' + token
        }
      }
    );


    if (!response.ok){
      throw new Error(
        'Could not load report'
      );
    }


    const reports =
      await response.json();


    const report =
      reports.find(
        r => r.report_id === reportId
      );


    if (!report){
      container.innerHTML = `
        <div class="empty-state">
          Report not found or you do not have access to it.
        </div>
      `;

      return;
    }


    const imageUrl =
      report.image_key ||
      report.redacted_image_key
        ? await getSecureImageUrl(
            report.report_id
          )
        : null;


    let statusClass =
      'status-active';

    let statusLabel =
      'Active';


    if (report.status === 'resolved'){
      statusClass =
        'status-resolved';

      statusLabel =
        'Resolved';
    }

    else if (
      (report.matches || [])
        .some(
          m =>
            m.match_status ===
            'needs_review'
        )
    ){
      statusClass =
        'status-review';

      statusLabel =
        'Under Review';
    }


    container.innerHTML = `
      <div class="details-card">

        ${
          imageUrl
            ? `
              <img
                class="details-image"
                src="${imageUrl}"
                alt="Report item"
              >
            `
            : ''
        }


        <div class="details-top">

          <div>

            <div class="details-type">
              ${
                report.report_type === 'lost'
                  ? 'Lost Item'
                  : 'Found Item'
              }
              · ${report.report_id}
            </div>

            <div class="details-title">
              ${
                report.manual_color
                  ? escapeHtml(report.manual_color) + ' '
                  : ''
              }
              ${escapeHtml(report.category)}
            </div>

          </div>


          <div>
            <span
              class="status-pill ${statusClass}"
            >
              <span class="dot"></span>
              ${statusLabel}
            </span>
          </div>

        </div>


        <div class="details-grid">

          <div class="detail-box">
            <div class="detail-label">
              Category
            </div>

            <div class="detail-value">
              ${escapeHtml(report.category || '—')}
            </div>
          </div>


          <div class="detail-box">
            <div class="detail-label">
              Colour
            </div>

            <div class="detail-value">
              ${escapeHtml(report.manual_color || '—')}
            </div>
          </div>


          <div class="detail-box">
            <div class="detail-label">
              Location
            </div>

            <div class="detail-value">
              ${escapeHtml(report.area || '—')}
            </div>
          </div>


          <div class="detail-box">
            <div class="detail-label">
              Date
            </div>

            <div class="detail-value">
              ${escapeHtml(report.event_date || '—')}
            </div>
          </div>


          ${
            report.report_type === 'found'
              ? `
                <div class="detail-box full">
                  <div class="detail-label">
                    Collection / handover point
                  </div>

                  <div class="detail-value">
                    ${
                      escapeHtml(report.handover_venue) ||
                      'Not specified'
                    }
                  </div>
                </div>
              `
              : ''
          }


          ${
            report.ai_description
              ? `
                <div class="detail-box full">
                  <div class="detail-label">
                    AI image description
                  </div>

                  <div class="detail-value">
                    ${escapeHtml(report.ai_description)}
                  </div>
                </div>
              `
              : ''
          }


          <div class="detail-box full">
            <div class="detail-label">
              Distinguishing details
            </div>

            <div class="detail-value">
              ${
                escapeHtml(report.details) ||
                'No additional details provided.'
              }
            </div>
          </div>

        </div>

      </div>
    `;


  } catch (error){
    console.error(
      'Report details error:',
      error
    );

    container.innerHTML = `
      <div class="empty-state">
        Could not load this report.
      </div>
    `;
  }

})();
}


//starr review
if (document.getElementById('reviewQueue')) {
(function(){
  let allReports = [];

  //backend checks the cognito staff group
  async function getStaffImageUrl(reportId){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token){
      return null;
    }

    try {
      const response = await fetch(
        'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports/' +
        encodeURIComponent(reportId) +
        '/image',
        {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        }
      );

      if (!response.ok){
        return null;
      }

      const data = await response.json();
      return data.image_url || null;

    } catch (error){
      console.error('Load staff image error:', error);
      return null;
    }
  }

  async function loadStaffData(){
    try {
      const token = sessionStorage.getItem('back2u_access_token');

      const response = await fetch(
        'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/reports',
        {
          headers: {
            'Authorization': 'Bearer ' + token
          }
        }
      );

      if (!response.ok){
        throw new Error('Could not load reports');
      }

      allReports = await response.json();

      //only loads images that are actually needed in the review queue
      const imageIds = new Set();

      allReports.forEach(report => {
        if (
          report.report_type === 'lost' &&
          (report.matches || []).some(match =>
            match.match_status === 'needs_review'
          )
        ){
          imageIds.add(report.report_id);

          (report.matches || []).forEach(match => {
            imageIds.add(match.matched_report_id);
          });
        }
      });

      await Promise.all(
        Array.from(imageIds).map(async reportId => {
          const report = allReports.find(r =>
            r.report_id === reportId
          );

          if (report){
            report.secureImageUrl =
              await getStaffImageUrl(reportId);
          }
        })
      );

      return allReports;

    } catch (error){
      console.error('Staff review load error:', error);
      allReports = [];
      return allReports;
    }
  }


  async function updateStaffMatchStatus(matchId, status){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token){
      throw new Error('Please sign in first');
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/matches/' +
      encodeURIComponent(matchId),
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          status: status
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok){
      throw new Error(
        data.message ||
        data.error ||
        'Could not update match'
      );
    }

    return data;
  }

  //sends an sns email only after staff has confirmed the match
  async function notifyConfirmedMatch(matchId){
    const token = sessionStorage.getItem('back2u_access_token');

    if (!token){
      throw new Error('Please sign in first');
    }

    const response = await fetch(
      'https://yvrslps3nd.execute-api.us-east-1.amazonaws.com/test/notify-match',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          match_id: matchId,
          status: 'confirmed'
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok){
      throw new Error(
        data.error ||
        data.message ||
        'Could not send notification'
      );
    }

    return data;
  }


  function reportTitle(report){
    return (
      escapeHtml(
        (report.manual_color ? report.manual_color + ' ' : '') +
        report.category
      )
    );
  }


  function renderQueue(){
    const el = document.getElementById('reviewQueue');
    el.innerHTML = '';

    const reportMap = new Map(
      allReports.map(report => [
        report.report_id,
        report
      ])
    );

    //one lost report can be connected to many found candidates
    const reviewReports = allReports.filter(report =>
      report.report_type === 'lost' &&
      (report.matches || []).some(match =>
        match.match_status === 'needs_review'
      )
    );

    if (reviewReports.length === 0){
      el.innerHTML = `
        <div class="empty-state">
          Queue's clear — no matches waiting on a review right now.
        </div>
      `;
      return;
    }

    reviewReports.forEach(report => {
      const card = document.createElement('div');
      card.className = 'review-card';

      const matches = report.matches || [];

      const candidatesHtml = matches.map((match, index) => {
        const matchedReport = reportMap.get(
          match.matched_report_id
        );

        if (!matchedReport){
          return '';
        }

        const statusText =
          match.match_status === 'needs_review'
            ? 'User requested review'
            : match.match_status === 'confirmed'
            ? 'Confirmed match'
            : 'Alternative AI suggestion';

        const staffActions =
          match.match_status === 'needs_review'
            ? `
              <div
                class="review-note"
                style="margin-top:10px;"
              >
                ✹ A user asked staff to verify this match.
              </div>

              <div class="review-actions">
                <button
                  class="btn staff-match-action"
                  data-match-id="${match.match_id}"
                  data-status="rejected"
                >
                  Reject Match
                </button>

                <button
                  class="btn btn-dark staff-match-action"
                  data-match-id="${match.match_id}"
                  data-status="confirmed"
                >
                  Confirm Match
                </button>
              </div>
            `

            : match.match_status === 'candidate'
            ? `
              <div
                style="
                  margin-top:10px;
                  font-size:12px;
                  color:var(--ink-soft);
                "
              >
                AI found this as another possible match.
                Staff can select it instead if it is a better fit.
              </div>

              <div class="review-actions">
                <button
                  class="btn btn-dark staff-match-action"
                  data-match-id="${match.match_id}"
                  data-status="confirmed"
                >
                  Confirm This Match
                </button>
              </div>
            `

            : '';

        return `
          <div style="
            margin-top:${index === 0 ? '0' : '18px'};
            padding-top:${index === 0 ? '0' : '18px'};
            border-top:${index === 0 ? 'none' : '1px dashed var(--line)'};
          ">

            <div class="review-head">
              <div class="match-label">
                Candidate ${index + 1} · ${statusText}
              </div>

              <div class="review-conf">
                ${Number(match.overall_score).toFixed(2)}% confidence
              </div>
            </div>

            <div class="compare-grid">

              <div class="compare-col">
                <div class="c-label">
                  Lost Report
                </div>

                ${report.secureImageUrl
                  ? `
                    <img
                      src="${report.secureImageUrl}"
                      alt="Lost report"
                      style="
                        width:100%;
                        max-height:170px;
                        object-fit:cover;
                        border-radius:10px;
                        margin:10px 0;
                      "
                    >
                  `
                  : ''
                }

                <div class="c-title">
                  ${reportTitle(report)}
                </div>

                <div class="c-meta">
                  ${report.report_id}
                  · ${escapeHtml(report.area)}
                  · ${escapeHtml(report.event_date)}
                </div>

                <div class="c-detail">
                  "${escapeHtml(report.details || 'No private details provided.')}"
                </div>

                <div class="chip-row">
                  <span class="mini-chip">
                    ${escapeHtml(report.category)}
                  </span>

                  ${report.manual_color
                    ? `
                      <span class="mini-chip">
                        ${escapeHtml(report.manual_color)}
                      </span>
                    `
                    : ''
                  }
                </div>
              </div>


              <div class="vs-divider">
                vs
              </div>


              <div class="compare-col">
                <div class="c-label">
                  Found Candidate
                </div>

                ${matchedReport.secureImageUrl
                  ? `
                    <img
                      src="${matchedReport.secureImageUrl}"
                      alt="Found candidate"
                      style="
                        width:100%;
                        max-height:170px;
                        object-fit:cover;
                        border-radius:10px;
                        margin:10px 0;
                      "
                    >
                  `
                  : ''
                }

                <div class="c-title">
                  ${reportTitle(matchedReport)}
                </div>

                <div class="c-meta">
                  ${matchedReport.report_id}
                  · ${escapeHtml(matchedReport.area)}
                  · ${escapeHtml(matchedReport.event_date)}
                </div>

                <div class="c-detail">
                  "${escapeHtml(matchedReport.details || 'No private details provided.')}"
                </div>

                <div class="chip-row">
                  <span class="mini-chip">
                    ${escapeHtml(matchedReport.category)}
                  </span>

                  ${matchedReport.manual_color
                    ? `
                      <span class="mini-chip">
                        ${escapeHtml(matchedReport.manual_color)}
                      </span>
                    `
                    : ''
                  }
                </div>
              </div>

            </div>


            <div style="
              margin-top:10px;
              font-size:12px;
              color:var(--ink-soft);
            ">
              Item ${Number(match.label_score).toFixed(2)}%
              · Colour ${Number(match.color_score).toFixed(2)}%
              · Location ${Number(match.location_score).toFixed(2)}%
              · Details ${Number(match.detail_score).toFixed(2)}%
            </div>

            ${staffActions}

          </div>
        `;
      }).join('');


      card.innerHTML = `
        <div class="review-head">
          <div>
            <div class="match-label">
              Report Under Review
            </div>

            <div style="
              font-size:18px;
              font-weight:600;
              margin-top:5px;
            ">
              ${reportTitle(report)}
            </div>

            <div style="
              font-size:12.5px;
              color:var(--ink-soft);
              margin-top:3px;
            ">
              ${report.report_id}
            </div>
          </div>

          <div class="review-conf">
            ${matches.length}
            possible match${matches.length === 1 ? '' : 'es'}
          </div>
        </div>

        ${candidatesHtml}
      `;

      el.appendChild(card);
    });


    document.querySelectorAll('.staff-match-action').forEach(button => {
      button.addEventListener('click', async () => {
        const matchId = button.dataset.matchId;
        const status = button.dataset.status;

        document.querySelectorAll('.staff-match-action').forEach(btn => {
          btn.disabled = true;
        });

        try {
          await updateStaffMatchStatus(
            matchId,
            status
          );

          let successMessage = '';

          //only emails when staff actually approves the match
          if (status === 'confirmed'){
            try {
              const notification = await notifyConfirmedMatch(
                matchId
              );

              console.log(
                'SNS notification sent:',
                notification
              );

              successMessage =
                'Match approved successfully. The notification email was sent.';

            } catch (notificationError){
              console.error(
                'SNS notification error:',
                notificationError
              );

              successMessage =
                'Match approved successfully, but the email notification could not be sent.';
            }

          } else {
            successMessage =
              'Match rejected successfully. It has been removed from the review.';
          }

          await loadStaffData();
          renderQueue();
          renderOversight();

          alert(successMessage);

        } catch (error){
          console.error('Staff decision error:', error);

          alert(
            'Could not update this match. Please try again.'
          );

          document.querySelectorAll('.staff-match-action').forEach(btn => {
            btn.disabled = false;
          });
        }
      });
    });
  }


  function renderOversight(){
    const body = document.getElementById('oversightBody');

    body.innerHTML = allReports.map(report => `
      <tr>
        <td>${report.report_id}</td>

        <td>
          ${report.report_type === 'lost'
            ? 'Lost'
            : 'Found'}
        </td>

        <td>
          ${reportTitle(report)}
        </td>

        <td>
          ${escapeHtml(report.status)}
        </td>

        <td>
          ${escapeHtml(report.event_date)}
        </td>
      </tr>
    `).join('');
  }


  //needs staff to be signed in first
  if (sessionStorage.getItem('back2u_staff_session') !== 'active'){
    window.location.href = 'staff_login.html';
  } else {
    loadStaffData().then(() => {
      renderQueue();
      renderOversight();
    });
  }
})();
}



//staff login
if (document.getElementById('staffLoginForm')) {
(function(){
  const COGNITO_CLIENT_ID = '2lbs1a9n0khdfj6pmld83ql276';
  const COGNITO_ENDPOINT = 'https://cognito-idp.us-east-1.amazonaws.com/';

  async function cognitoRequest(action, body){
    const response = await fetch(COGNITO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + action
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok){
      throw new Error(data.message || data.Message || 'Could not sign in');
    }

    return data;
  }

  async function staffLogin(email, password){
    const result = await cognitoRequest('InitiateAuth', {
      AuthFlow: 'USER_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PREFERRED_CHALLENGE: 'PASSWORD',
        PASSWORD: password
      }
    });

    if (!result.AuthenticationResult){
      throw new Error('Could not complete sign in');
    }

    return result.AuthenticationResult;
  }

  document.getElementById('staffLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('staffLoginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing In…';

    try {
      const auth = await staffLogin(
        document.getElementById('staffEmail').value,
        document.getElementById('staffPassword').value
      );

      const payload = JSON.parse(
        atob(
          auth.AccessToken.split('.')[1]
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        )
      );

      //checks actual cognito staff group 
      const groups = payload['cognito:groups'] || [];

      if (!groups.includes('staff')){
        throw new Error('This account does not have staff access');
      }

      sessionStorage.setItem('back2u_access_token', auth.AccessToken);
      sessionStorage.setItem('back2u_id_token', auth.IdToken);

      if (auth.RefreshToken){
        sessionStorage.setItem('back2u_refresh_token', auth.RefreshToken);
      }

      sessionStorage.setItem('back2u_staff_session', 'active');

      window.location.href = 'staff_review.html';

    } catch (error) {
      console.error('Staff login error:', error);
      alert(error.message);

      btn.disabled = false;
      btn.textContent = 'Sign In to Staff Portal';
    }
  });
})();
}

// Usamos /skill-api que es manejado por Vite en Local y por Firebase Functions en Producción
const API_URL = '/skill-api';

// Credenciales de Skill Suite (hardcoded porque .env tiene problemas con caracteres especiales)
const SKILL_CONFIG = {
  username: 'wsSk4Api',
  password: '5qT2Uu!qIjG%$XeD',
  companyAuthId: 'xudQREZBrfGdw0ag8tE3NR3XhM6LGa',
  recintoIdData: {
    CCCR: 14,
    CCCI: 15,
    CEVP: 16
  }
};

/**
 * Autentica con Skill API y devuelve el token.
 */
async function getSkillToken() {
  console.log('>>> getSkillToken llamado');
  const response = await fetch(`${API_URL}/authenticate`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'companyAuthId': SKILL_CONFIG.companyAuthId
    },
    body: JSON.stringify({
      username: SKILL_CONFIG.username,
      password: SKILL_CONFIG.password,
      companyAuthId: SKILL_CONFIG.companyAuthId,
      companyId: ""
    })
  });
  
  console.log('>>> Auth response status:', response.status);
  
  if (!response.ok) {
    const text = await response.text();
    console.log('>>> Auth error text:', text);
    if (text.includes('Offline')) {
      throw new Error('El sistema Skill Suite se encuentra fuera de línea');
    }
    throw new Error(`Error autenticación Skill (${response.status})`);
  }

  const data = await response.json();
  console.log('>>> Auth data:', data);
  if (!data.success) {
    throw new Error(data.errorMessage || 'Credenciales de Skill inválidas');
  }
  return data.result.token;
}

/**
 * Busca un evento por su eventNumber.
 * @param {string|number} eventNumber 
 * @param {string} recinto CCCR, CCCI o CEVP
 */
export async function getEventByNumber(eventNumber, recinto) {
  if (!eventNumber) return null;
  
  try {
    const token = await getSkillToken();
    const idDataValue = SKILL_CONFIG.recintoIdData[recinto] || 14;

    const response = await fetch(`${API_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'idData': String(idDataValue),
        'companyAuthId': SKILL_CONFIG.companyAuthId
      },
      body: JSON.stringify({
        Events: { eventNumber: parseInt(eventNumber, 10) }
      })
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.success && data.result?.events?.[0]) {
      return data.result.events[0];
    }
    return null;
  } catch {
    return null;
  }
}

<?php
header('Content-Type: application/json');

// Leggi il corpo della richiesta POST
$json = file_get_contents('php://input');

if ($json) {
    // Valida che sia un JSON corretto
    $decoded = json_decode($json);
    if (json_last_error() === JSON_ERROR_NONE) {
        // Salva nel file viale_calibration.json
        $bytes = file_put_contents('viale_calibration.json', $json);
        if ($bytes !== false) {
            echo json_encode(['success' => true, 'message' => 'Dati salvati con successo.']);
            exit;
        }
    }
}

http_response_code(400);
echo json_encode(['success' => false, 'message' => 'Errore nel salvataggio dei dati.']);
?>
